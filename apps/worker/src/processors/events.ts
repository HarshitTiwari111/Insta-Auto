import { DelayedError, type Job } from "bullmq";
import {
  cached,
  clampUtf8,
  consume,
  currentMediaUrl,
  env,
  flowReply,
  type FlowState,
  generateAiReply,
  isBlockedUser,
  isSpamComment,
  IgApiError,
  keys,
  logger,
  markOnce,
  matchRule,
  pickTemplate,
  redis,
  renderTemplate,
  type EventJob,
  type NormalizedEvent,
} from "@instaauto/core";
import { prisma, type AutomationRule, type IgAccount } from "@instaauto/db";
import { DeferError, flowsFor, gateAutomation, humanPause, igFor, log, notify, rulesFor, takeDailyAction } from "../shared.js";

/** Same DM rule won't fire twice for the same person within this window. */
const DM_RULE_COOLDOWN_SEC = 10 * 60;
/** Meta: private replies on posts/reels = 750 calls per hour per account. */
const PRIVATE_REPLY_PER_HOUR = 750;

export async function processEvent(job: Job<EventJob>, token?: string): Promise<void> {
  const ev = job.data.event;
  const acc = await prisma.igAccount.findUnique({ where: { igUserId: ev.igUserId } });
  if (!acc) {
    logger.warn({ igUserId: ev.igUserId }, "event for unknown account");
    return;
  }
  try {
    if (ev.kind === "comment") await onComment(acc, ev);
    else if (ev.kind === "message") await onMessage(acc, ev);
    await prisma.webhookEvent.updateMany({ where: { dedupeKey: ev.dedupeKey }, data: { processedAt: new Date(), error: null } });
  } catch (err) {
    if (err instanceof DeferError && token) {
      // Working hours / hourly limit: park the job, it runs again at `until` (no retry attempt used)
      await log(acc.id, "automation.deferred", { reason: err.reason, until: err.until });
      await job.moveToDelayed(err.until.getTime(), token);
      throw new DelayedError();
    }
    await prisma.webhookEvent.updateMany({ where: { dedupeKey: ev.dedupeKey }, data: { error: String((err as Error).message) } });
    if (err instanceof IgApiError && err.isAuthError) {
      await log(acc.id, "error.token", { message: err.message });
      await notify("Instagram reconnect needed", `@${acc.username}: access token rejected. Reconnect in Settings.`, "/settings");
      return; // retrying won't help
    }
    throw err; // BullMQ retries with exponential backoff
  }
}

async function onComment(acc: IgAccount, ev: Extract<NormalizedEvent, { kind: "comment" }>) {
  // Never react to our own comments/replies (prevents reply loops)
  if (ev.fromId === acc.igUserId || ev.fromUsername === acc.username) return;
  if (acc.paused) return;

  // Blacklisted accounts: never auto-replied to; optionally hidden
  if (isBlockedUser(acc.blocklist, ev.fromUsername)) {
    if (acc.blocklistHide) {
      const done = await once(`hide:${ev.commentId}`, async () => {
        if (!(await takeDailyAction(acc))) return false;
        await igFor(acc).setCommentHidden(ev.commentId, true);
        await log(acc.id, "comment.blocked_hide", { commentId: ev.commentId, from: ev.fromUsername, text: ev.text.slice(0, 200) });
        return true;
      });
      if (done === false) await limitHit(acc);
    }
    return;
  }

  if (acc.aiSpamFilter && (await aiSpamHidden(acc, ev))) return;

  const rule = matchRule(await rulesFor(acc.id, "COMMENT"), { trigger: "COMMENT", text: ev.text, mediaId: ev.mediaId });
  if (!rule) return;
  await gateAutomation(acc);
  await humanPause(acc, `comment:${ev.commentId}`);

  const ig = igFor(acc);
  const base = { ruleId: rule.id, rule: rule.name, commentId: ev.commentId, from: ev.fromUsername, text: ev.text.slice(0, 200) };

  // Spam: delete and stop (nothing else makes sense on a deleted comment)
  if (rule.deleteComment) {
    const done = await once(`delete:${ev.commentId}`, async () => {
      if (!(await takeDailyAction(acc))) return false;
      await ig.deleteComment(ev.commentId);
      await log(acc.id, "comment.delete", base);
      return true;
    });
    if (done === false) await limitHit(acc);
    return;
  }

  // Each action runs at most once per comment, so a BullMQ retry never double-posts.
  if (rule.hideComment) {
    const done = await once(`hide:${ev.commentId}`, async () => {
      if (!(await takeDailyAction(acc))) return false;
      await ig.setCommentHidden(ev.commentId, true);
      await log(acc.id, "comment.hide", base);
      return true;
    });
    if (done === false) return void (await limitHit(acc));
  }

  if (!rule.hideComment && (rule.aiReply || rule.replyTemplates.length)) {
    const done = await once(`reply:${ev.commentId}`, async () => {
      const text = await replyText(rule, "comment", ev.text, ev.fromUsername);
      if (!text) {
        await log(acc.id, "ai.skipped", base);
        return true;
      }
      if (!(await takeDailyAction(acc))) return false;
      const r = await ig.replyToComment(ev.commentId, text);
      await log(acc.id, "comment.reply", { ...base, reply: text, replyId: r.id, ai: rule.aiReply });
      return true;
    });
    if (done === false) return void (await limitHit(acc));
  }

  const dm = pickTemplate(rule.privateReplyTemplates);
  if (dm) {
    // Meta allows exactly one private reply per comment
    if (!(await markOnce(redis(), keys.privateReplyDone(ev.commentId), 8 * 24 * 3600))) return;
    const rl = await consume(redis(), keys.rlPrivateReplies(acc.id), PRIVATE_REPLY_PER_HOUR, 3600);
    if (!rl.allowed) {
      await redis().del(keys.privateReplyDone(ev.commentId));
      throw new Error(`private reply hourly limit reached, retry in ${rl.resetIn}s`);
    }
    if (!(await takeDailyAction(acc))) return void (await limitHit(acc));
    const text = clampUtf8(renderTemplate(dm, { username: ev.fromUsername }));
    try {
      const r = await ig.privateReply(ev.commentId, text);
      await prisma.dmMessage.create({
        data: { accountId: acc.id, igsid: r.recipient_id, username: ev.fromUsername ?? null, direction: "OUT", text, mid: r.message_id, ruleId: rule.id },
      });
      await log(acc.id, "comment.private_reply", { ...base, dm: text });
    } catch (err) {
      await redis().del(keys.privateReplyDone(ev.commentId));
      throw err;
    }
  }
}

async function onMessage(acc: IgAccount, ev: Extract<NormalizedEvent, { kind: "message" }>) {
  if (ev.isEcho) {
    // Message sent by the account (from the app or by a human in Instagram). Store once.
    await prisma.dmMessage.upsert({
      where: { mid: ev.mid },
      create: { accountId: acc.id, igsid: ev.recipientId, direction: "OUT", text: ev.text, mid: ev.mid, createdAt: new Date(ev.timestamp) },
      update: {},
    });
    return;
  }

  const username = await senderUsername(acc, ev.senderId);
  await prisma.dmMessage.upsert({
    where: { mid: ev.mid },
    create: { accountId: acc.id, igsid: ev.senderId, username, direction: "IN", text: ev.text, mid: ev.mid, createdAt: new Date(ev.timestamp) },
    update: {},
  });
  // User messaged us -> standard 24h messaging window is open
  await redis().set(keys.dmWindow(acc.id, ev.senderId), String(ev.timestamp), "EX", 24 * 3600);
  // Once per message: a deferred job runs this function again later
  if (await markOnce(redis(), keys.dedupe(`notify:${ev.mid}`), 48 * 3600)) {
    await notify(`New DM on @${acc.username}`, ev.text?.slice(0, 120) ?? "(attachment)", "/inbox");
  }

  if (acc.paused || !ev.text) return;
  if (await dmSenderBlocked(acc, ev.senderId)) return;
  if (await handleFlow(acc, ev, ev.text)) return; // chatbot flows win over plain DM rules
  const rule = matchRule(await rulesFor(acc.id, "DM"), { trigger: "DM", text: ev.text });
  if (!rule) return;
  if (!rule.aiReply && !rule.replyTemplates.length) return;
  await gateAutomation(acc);
  await humanPause(acc, `dm:${ev.mid}`);

  if (!(await redis().exists(keys.dmWindow(acc.id, ev.senderId)))) return; // window closed
  if (!(await markOnce(redis(), keys.ruleCooldown(acc.id, ev.senderId, rule.id), DM_RULE_COOLDOWN_SEC))) return;

  let reply: string | null;
  try {
    reply = await replyText(rule, "dm", ev.text);
  } catch (err) {
    await redis().del(keys.ruleCooldown(acc.id, ev.senderId, rule.id)); // let the retry through
    throw err;
  }
  if (!reply) return void (await log(acc.id, "ai.skipped", { ruleId: rule.id, rule: rule.name, from: ev.senderId }));
  if (!(await takeDailyAction(acc))) return void (await limitHit(acc));

  const text = clampUtf8(reply);
  const r = await igFor(acc).sendText(ev.senderId, text, rule.quickReplies ?? []);
  await prisma.dmMessage.upsert({
    where: { mid: r.message_id },
    create: { accountId: acc.id, igsid: ev.senderId, direction: "OUT", text, mid: r.message_id, ruleId: rule.id },
    update: { ruleId: rule.id },
  });
  await log(acc.id, "dm.reply", { ruleId: rule.id, rule: rule.name, to: ev.senderId, reply: text, ai: rule.aiReply });

  // Optional photo / video after the text. The text already went out, so a failure here is logged, not retried.
  if (rule.replyMediaUrl) {
    const url = currentMediaUrl(rule.replyMediaUrl);
    try {
      const m = await igFor(acc).sendMedia(ev.senderId, url, /\.(mp4|mov)(\?|$)/i.test(url) ? "video" : "image");
      await prisma.dmMessage.upsert({
        where: { mid: m.message_id },
        create: { accountId: acc.id, igsid: ev.senderId, direction: "OUT", text: "(photo/video)", mid: m.message_id, ruleId: rule.id },
        update: {},
      });
    } catch (err) {
      logger.warn({ err: (err as Error).message, ruleId: rule.id }, "DM media failed");
      await log(acc.id, "error.dm_media", { ruleId: rule.id, message: (err as Error).message });
    }
  }
}

/**
 * DMs carry only the sender's IGSID, so look the username up (cached 7 days) to apply the blacklist.
 * If the lookup fails we don't block: a missed block is better than ignoring a real customer.
 */
async function dmSenderBlocked(acc: IgAccount, igsid: string): Promise<boolean> {
  if (!acc.blocklist.length) return false;
  return isBlockedUser(acc.blocklist, await senderUsername(acc, igsid));
}

/** @username of someone who messaged us (User Profile API, cached 7 days). null when Meta won't say. */
async function senderUsername(acc: IgAccount, igsid: string): Promise<string | null> {
  try {
    const u = await cached<string>(redis(), `ia:cache:igsid:${acc.id}:${igsid}`, 7 * 24 * 3600, async () => {
      const p = await igFor(acc).userProfile(igsid);
      return p.username ?? "";
    });
    return u || null;
  } catch (err) {
    logger.warn({ err: (err as Error).message, igsid }, "username lookup failed");
    return null;
  }
}

/**
 * DM chatbot flows. Returns true when the message belonged to a flow (even if nothing could be sent,
 * e.g. the 24h window is closed), so DM rules don't also answer it.
 */
async function handleFlow(acc: IgAccount, ev: Extract<NormalizedEvent, { kind: "message" }>, text: string): Promise<boolean> {
  const flows = await flowsFor(acc.id);
  if (!flows.length) return false;
  const stateKey = keys.flowState(acc.id, ev.senderId);
  const raw = await redis().get(stateKey);
  const res = flowReply(flows, raw ? (JSON.parse(raw) as FlowState) : null, text);
  if (!res) return false;
  if (!(await redis().exists(keys.dmWindow(acc.id, ev.senderId)))) return true;

  await gateAutomation(acc);
  await humanPause(acc, `flow:${ev.mid}`);
  const sentKey = keys.dedupe(`flowsent:${ev.mid}`);
  if (!(await markOnce(redis(), sentKey, 48 * 3600))) return true; // already answered (retry / redelivery)
  if (!(await takeDailyAction(acc))) {
    await redis().del(sentKey);
    await limitHit(acc);
    return true;
  }
  try {
    const reply = clampUtf8(res.step.text);
    const r = await igFor(acc).sendText(ev.senderId, reply, res.step.buttons.map((b) => b.title));
    await prisma.dmMessage.upsert({
      where: { mid: r.message_id },
      create: { accountId: acc.id, igsid: ev.senderId, direction: "OUT", text: reply, mid: r.message_id },
      update: {},
    });
    await log(acc.id, "dm.flow", { flowId: res.flow.id, step: res.step.id, to: ev.senderId, reply });
  } catch (err) {
    await redis().del(sentKey);
    throw err;
  }
  if (res.state) await redis().set(stateKey, JSON.stringify(res.state), "EX", 24 * 3600);
  else await redis().del(stateKey);
  return true;
}

/**
 * Per-account AI spam filter: hides spam before any rule runs. Runs at any hour (hiding spam
 * at night is wanted). If Gemini is down the comment just goes on to the normal rules.
 */
async function aiSpamHidden(acc: IgAccount, ev: Extract<NormalizedEvent, { kind: "comment" }>): Promise<boolean> {
  const e = env();
  if (!e.GEMINI_API_KEY || !ev.text.trim()) return false;
  let spam: boolean;
  try {
    spam = await isSpamComment({ apiKey: e.GEMINI_API_KEY, model: e.GEMINI_MODEL, text: ev.text });
  } catch (err) {
    logger.warn({ err: (err as Error).message, commentId: ev.commentId }, "AI spam check failed");
    return false;
  }
  if (!spam) return false;
  const done = await once(`hide:${ev.commentId}`, async () => {
    if (!(await takeDailyAction(acc))) return false;
    await igFor(acc).setCommentHidden(ev.commentId, true);
    await log(acc.id, "comment.ai_spam", { commentId: ev.commentId, from: ev.fromUsername, text: ev.text.slice(0, 200) });
    return true;
  });
  if (done === false) await limitHit(acc);
  return true;
}

/**
 * Reply text for a matched rule. AI when the rule asks for it (templates are the fallback
 * if Gemini fails), otherwise a random template. null = AI decided not to reply (spam/abuse).
 */
async function replyText(rule: AutomationRule, kind: "comment" | "dm", message: string, username?: string): Promise<string | null> {
  const tpl = pickTemplate(rule.replyTemplates);
  const fallback = tpl ? renderTemplate(tpl, { username }) : null;
  const e = env();
  if (!rule.aiReply || !e.GEMINI_API_KEY) return fallback;
  try {
    return await generateAiReply({
      apiKey: e.GEMINI_API_KEY,
      model: e.GEMINI_MODEL,
      kind,
      businessInfo: rule.aiInstructions ?? "",
      message,
      username,
    });
  } catch (err) {
    logger.warn({ err: (err as Error).message, ruleId: rule.id }, "AI reply failed");
    if (fallback) return fallback;
    throw err; // no fallback: BullMQ retries later
  }
}

/**
 * Run fn only if this action key was never completed. Returns fn's result,
 * or null if it already ran. On failure (or fn returning false) the key is released.
 */
async function once(action: string, fn: () => Promise<boolean>): Promise<boolean | null> {
  const k = `ia:done:${action}`;
  if (!(await markOnce(redis(), k, 8 * 24 * 3600))) return null;
  try {
    const ok = await fn();
    if (!ok) await redis().del(k);
    return ok;
  } catch (err) {
    await redis().del(k);
    throw err;
  }
}

async function limitHit(acc: IgAccount) {
  // Notify once per day
  if (await markOnce(redis(), `${keys.dailyActions(acc.id, new Date().toISOString().slice(0, 10))}:notified`, 26 * 3600)) {
    await log(acc.id, "limit.daily_reached", { limit: acc.dailyActionLimit });
    await notify("Daily limit reached", `@${acc.username} hit ${acc.dailyActionLimit} actions today. Automation paused until tomorrow (UTC).`, "/settings");
  }
}
