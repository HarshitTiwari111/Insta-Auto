import type { Job } from "bullmq";
import {
  cached,
  decrypt,
  encrypt,
  env,
  keys,
  logger,
  markOnce,
  redis,
  refreshLongLived,
  schedulePublish,
  type IgMedia,
  type MaintenanceJob,
  countActivity,
  reportText,
  uploadDir,
  uploadedMediaName,
  utcDay,
} from "@instaauto/core";
import { prisma } from "@instaauto/db";
import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { igFor, log, notify, q } from "../shared.js";

const DAY = 24 * 3600 * 1000;

export async function processMaintenance(job: Job<MaintenanceJob>): Promise<void> {
  switch (job.data.task) {
    case "refresh-tokens":
      return refreshTokens();
    case "sweep-posts":
      return sweepPosts();
    case "poll-comments":
      return pollComments();
    case "cleanup":
      return cleanup();
    case "snapshot-stats":
      return snapshotStats();
    case "report":
      return sendReport(job.data.period);
  }
}

/**
 * Instagram Login tokens last ~60 days and can be refreshed once they are 24h+ old.
 * We refresh anything expiring within 10 days, daily. Facebook Login Page tokens don't expire.
 */
async function refreshTokens() {
  const soon = new Date(Date.now() + 10 * DAY);
  const accounts = await prisma.igAccount.findMany({
    where: { authType: "INSTAGRAM", tokenExpiresAt: { lt: soon }, tokenRefreshedAt: { lt: new Date(Date.now() - DAY) } },
  });
  for (const acc of accounts) {
    try {
      const t = await refreshLongLived(decrypt(acc.accessTokenEnc, env().TOKEN_ENC_KEY));
      await prisma.igAccount.update({
        where: { id: acc.id },
        data: { accessTokenEnc: encrypt(t.accessToken, env().TOKEN_ENC_KEY), tokenExpiresAt: t.expiresAt, tokenRefreshedAt: new Date() },
      });
      await log(acc.id, "token.refreshed", { expiresAt: t.expiresAt });
    } catch (err) {
      logger.error({ err, accountId: acc.id }, "token refresh failed");
      await log(acc.id, "error.token_refresh", { message: (err as Error).message });
      await notify("Instagram reconnect needed", `@${acc.username}: token refresh failed. Reconnect in Settings.`, "/settings");
    }
  }
}

/**
 * Follower growth needs history Meta doesn't give us without the insights permission:
 * store today's counters (hourly upsert, the day's last value wins).
 */
async function snapshotStats() {
  const day = utcDay();
  for (const acc of await prisma.igAccount.findMany()) {
    try {
      const p = await igFor(acc).profile();
      if (p.followers_count === undefined) continue;
      const data = { followers: p.followers_count, follows: p.follows_count ?? null, mediaCount: p.media_count ?? 0 };
      await prisma.accountStat.upsert({
        where: { accountId_day: { accountId: acc.id, day } },
        create: { accountId: acc.id, day, ...data },
        update: data,
      });
    } catch (err) {
      logger.warn({ err: (err as Error).message, accountId: acc.id }, "stats snapshot failed");
    }
  }
}

/** Weekly / monthly summary per account: activity log entry + push notification. */
async function sendReport(period: "weekly" | "monthly") {
  const days = period === "weekly" ? 7 : 30;
  const since = new Date(Date.now() - days * DAY);
  for (const acc of await prisma.igAccount.findMany()) {
    const [activity, dmsReceived, stats] = await Promise.all([
      prisma.activityLog.findMany({ where: { accountId: acc.id, createdAt: { gte: since } }, select: { kind: true } }),
      prisma.dmMessage.count({ where: { accountId: acc.id, direction: "IN", createdAt: { gte: since } } }),
      prisma.accountStat.findMany({ where: { accountId: acc.id, day: { gte: utcDay(since) } }, orderBy: { day: "asc" }, select: { followers: true } }),
    ]);
    const counts = {
      ...countActivity(activity.map((a) => a.kind)),
      dmsReceived,
      followersStart: stats[0]?.followers ?? null,
      followersEnd: stats.at(-1)?.followers ?? null,
    };
    const text = reportText(period, counts);
    await log(acc.id, `report.${period}`, { ...counts, text });
    await notify(`@${acc.username} ${period} report`, text, "/analytics");
  }
}

/** Safety net: re-queue PENDING posts whose delayed job is missing (e.g. Redis was flushed). Also runs auto-delete. */
async function sweepPosts() {
  await autoDeletePosts();
  const due = await prisma.scheduledPost.findMany({
    where: { status: "PENDING", scheduledAt: { lt: new Date(Date.now() + 10 * 60_000) } },
    take: 200,
  });
  for (const p of due) {
    const job = await q().publish.getJob(p.id);
    if (!job) {
      await schedulePublish(q(), p.id, p.scheduledAt);
      logger.info({ postId: p.id }, "re-queued missing publish job");
    }
  }
}

/** Remove published posts from Instagram once their auto-delete time has passed (checked every 5 min). */
async function autoDeletePosts() {
  const due = await prisma.scheduledPost.findMany({
    where: { status: "PUBLISHED", deletedAt: null, igMediaId: { not: null }, deleteAt: { lte: new Date() } },
    include: { account: true },
    take: 50,
  });
  for (const p of due) {
    try {
      await igFor(p.account).deleteMedia(p.igMediaId!);
      await prisma.scheduledPost.update({ where: { id: p.id }, data: { deletedAt: new Date(), error: null } });
      await log(p.accountId, "post.auto_deleted", { postId: p.id, igMediaId: p.igMediaId });
      await notify("Post deleted", `@${p.account.username}: ${p.type.toLowerCase()} removed (auto-delete)`, "/posts");
    } catch (err) {
      const msg = (err as Error).message;
      // Not retried forever: clear the time, keep the reason on the post
      await prisma.scheduledPost.update({ where: { id: p.id }, data: { deleteAt: null, error: `Auto-delete failed: ${msg}` } });
      await log(p.accountId, "post.auto_delete_failed", { postId: p.id, error: msg });
      await notify("Auto-delete failed", `@${p.account.username}: ${msg}`, "/posts");
    }
  }
}

/**
 * Fallback for comment automation while the app lacks Advanced Access
 * (Meta docs: Advanced Access is required for `comments` webhooks).
 * Reads comments on the latest posts and feeds new ones into the same event queue.
 * Dedupe keys are shared with webhooks, so an event is never processed twice.
 */
async function pollComments() {
  const accounts = await prisma.igAccount.findMany({ where: { paused: false } });
  const status = { at: new Date().toISOString(), accounts: accounts.length, queued: 0, errors: [] as string[] };
  for (const acc of accounts) {
    try {
      const ig = igFor(acc);
      const sinceKey = keys.pollSince(acc.id);
      const sinceRaw = await redis().get(sinceKey);
      const since = sinceRaw ? new Date(sinceRaw) : null;
      if (!since) {
        // First run: start from now, never auto-reply to old comments
        await redis().set(sinceKey, new Date().toISOString());
        continue;
      }

      const media = await cached<IgMedia[]>(redis(), keys.media(acc.id), 300, async () => (await ig.listMedia(25)).data);
      let newest = since;
      // 2 min overlap so comments landing in the same second aren't missed; dedupe drops repeats
      const floor = new Date(since.getTime() - 120_000);
      const watch = [...media.slice(0, 10).filter((m) => m.comments_count), ...(await targetedOlderPosts(acc.id, ig, media.slice(0, 10)))];
      for (const m of watch) {
        const { data } = await ig.listComments(m.id, 50);
        for (const c of data) {
          const ts = c.timestamp ? new Date(c.timestamp) : null;
          if (!ts || ts <= floor) continue;
          if (ts > newest) newest = ts;
          const dedupeKey = `comment:${c.id}`;
          if (!(await markOnce(redis(), keys.dedupe(dedupeKey), 48 * 3600))) continue;
          await q().events.add(
            "comment",
            {
              event: {
                kind: "comment",
                igUserId: acc.igUserId,
                commentId: c.id,
                text: c.text ?? "",
                fromId: c.from?.id,
                fromUsername: c.from?.username ?? c.username,
                mediaId: m.id,
                parentId: c.parent_id,
                source: "poll",
                dedupeKey,
              },
            },
            { jobId: dedupeKey.replace(/:/g, "_") },
          );
          status.queued++;
        }
      }
      await redis().set(sinceKey, newest.toISOString());
    } catch (err) {
      logger.warn({ err: (err as Error).message, accountId: acc.id }, "comment poll failed");
      status.errors.push(`@${acc.username}: ${(err as Error).message}`.slice(0, 200));
    }
  }
  await redis().set(keys.lastPoll, JSON.stringify(status), "EX", 24 * 3600);
}

/**
 * Older posts/reels that an enabled comment rule targets: polled too, but only when their comment
 * count went up since the last poll (one `?ids=` request for all of them keeps API calls low).
 */
async function targetedOlderPosts(accountId: string, ig: ReturnType<typeof igFor>, latest: IgMedia[]): Promise<{ id: string }[]> {
  const rules = await prisma.automationRule.findMany({ where: { accountId, enabled: true, trigger: "COMMENT" }, select: { mediaIds: true } });
  const seen = new Set(latest.map((m) => m.id));
  const ids = [...new Set(rules.flatMap((r) => r.mediaIds))].filter((id) => !seen.has(id)).slice(0, 50);
  if (!ids.length) return [];
  const counts = await ig.commentCounts(ids);
  const changed: { id: string }[] = [];
  for (const id of ids) {
    const now = counts[id]?.comments_count ?? 0;
    const key = keys.commentCount(accountId, id);
    const before = await redis().get(key);
    await redis().set(key, String(now), "EX", 30 * 24 * 3600);
    // First time we see a post: remember its count, don't reply to old comments
    if (before !== null && now > Number(before)) changed.push({ id });
  }
  return changed;
}

async function cleanup() {
  const cutoff = new Date(Date.now() - 30 * DAY);
  const a = await prisma.webhookEvent.deleteMany({ where: { receivedAt: { lt: cutoff } } });
  const b = await prisma.activityLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 90 * DAY) } } });
  const files = await cleanupUploads();
  logger.info({ webhookEvents: a.count, activity: b.count, uploads: files }, "cleanup done");
}

/**
 * Uploaded media is only needed until Meta has fetched it. Delete uploads older than 7 days unless a
 * draft / scheduled / publishing post or a DM rule (photo/video reply) still points at them.
 * Works for both storages: disk (UPLOAD_DIR) and database (UPLOAD_STORAGE=db).
 */
async function cleanupUploads(): Promise<number> {
  const [open, rules] = await Promise.all([
    prisma.scheduledPost.findMany({ where: { status: { in: ["DRAFT", "PENDING", "PUBLISHING"] } }, select: { mediaUrls: true } }),
    prisma.automationRule.findMany({ where: { replyMediaUrl: { not: null } }, select: { replyMediaUrl: true } }),
  ]);
  const inUse = new Set(
    [...open.flatMap((p) => p.mediaUrls), ...rules.map((r) => r.replyMediaUrl!)].map(uploadedMediaName).filter(Boolean) as string[],
  );
  const cutoff = new Date(Date.now() - 7 * DAY);

  if (env().UPLOAD_STORAGE === "db") {
    const r = await prisma.mediaFile.deleteMany({ where: { createdAt: { lt: cutoff }, name: { notIn: [...inUse] } } });
    return r.count;
  }

  const dir = uploadDir();
  const names = await readdir(dir).catch(() => [] as string[]);
  let removed = 0;
  for (const name of names) {
    if (inUse.has(name)) continue;
    const path = join(dir, name);
    const info = await stat(path).catch(() => null);
    if (info?.isFile() && info.mtimeMs < cutoff.getTime()) {
      await unlink(path).catch(() => undefined);
      removed++;
    }
  }
  return removed;
}
