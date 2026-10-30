import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  bestPosts,
  bestTimes,
  cached,
  dmStats,
  hashtagPerformance,
  invalidate,
  keys,
  normalizeUsername,
  postStats,
  redis,
  summarize,
  utcDay,
  type IgMedia,
  type IgProfile,
} from "@instaauto/core";
import { prisma } from "@instaauto/db";
import { requireAuth } from "../plugins/auth.js";
import { igClientFor, log, publicAccountSelect } from "../ctx.js";
import { WEBHOOK_FIELDS } from "./instagram.js";

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** Instagram username: letters, digits, "." and "_", max 30; stored lowercase without "@" */
const Username = z
  .string()
  .transform(normalizeUsername)
  .pipe(z.string().regex(/^[a-z0-9._]{1,30}$/, "not a valid Instagram username"));

const PatchBody = z
  .object({
    paused: z.boolean().optional(),
    dailyActionLimit: z.number().int().min(0).max(100_000).optional(),
    hourlyActionLimit: z.number().int().min(1).max(10_000).optional(),
    workStartHour: z.number().int().min(0).max(23).nullable().optional(),
    workEndHour: z.number().int().min(0).max(23).nullable().optional(),
    timezone: z.string().refine(isTimeZone, "unknown time zone").optional(),
    aiSpamFilter: z.boolean().optional(),
    replySpeed: z.enum(["fast", "medium", "slow"]).optional(),
    blocklist: z.array(Username).max(1000).optional(),
    blocklistHide: z.boolean().optional(),
  })
  .refine((b) => (b.workStartHour === null) === (b.workEndHour === null), "set both working hours, or neither");

export default async function accountRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/accounts", async () => {
    const accounts = await prisma.igAccount.findMany({ select: publicAccountSelect, orderBy: { createdAt: "asc" } });
    const day = utcDay();
    const used = accounts.length
      ? await redis().mget(...accounts.map((a) => keys.dailyActions(a.id, day)))
      : [];
    return accounts.map((a, i) => ({ ...a, actionsToday: Number(used[i] ?? 0) }));
  });

  app.patch<{ Params: { id: string } }>("/accounts/:id", async (req, reply) => {
    const body = PatchBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "invalid_body" });
    const data = body.data.blocklist ? { ...body.data, blocklist: [...new Set(body.data.blocklist)] } : body.data;
    const acc = await prisma.igAccount.update({
      where: { id: req.params.id },
      data,
      select: publicAccountSelect,
    });
    await log(acc.id, "account.updated", { by: req.session!.email, ...body.data });
    return acc;
  });

  /** Add one username to the blacklist (from the Comments page). */
  app.post<{ Params: { id: string } }>("/accounts/:id/block", async (req, reply) => {
    const body = z.object({ username: Username }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "invalid_body" });
    const acc = await prisma.igAccount.findUnique({ where: { id: req.params.id }, select: { blocklist: true } });
    if (!acc) return reply.code(404).send({ error: "not_found" });
    const blocklist = [...new Set([...acc.blocklist, body.data.username])];
    await prisma.igAccount.update({ where: { id: req.params.id }, data: { blocklist } });
    await log(req.params.id, "account.blocked_user", { username: body.data.username, by: req.session!.email });
    return { blocklist };
  });

  /** Emergency stop: pause every account at once. Worker checks this flag before every action. */
  app.post("/accounts/stop-all", async (req) => {
    const r = await prisma.igAccount.updateMany({ data: { paused: true } });
    await log(null, "emergency.stop", { by: req.session!.email, accounts: r.count });
    return { paused: r.count };
  });

  app.delete<{ Params: { id: string } }>("/accounts/:id", async (req) => {
    await prisma.igAccount.delete({ where: { id: req.params.id } });
    await invalidate(redis(), keys.rules(req.params.id, "COMMENT"), keys.rules(req.params.id, "DM"), keys.media(req.params.id));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/accounts/:id/resubscribe", async (req, reply) => {
    const ig = await igClientFor(req.params.id);
    if (!ig) return reply.code(404).send({ error: "not_found" });
    const r = await ig.subscribeWebhooks(WEBHOOK_FIELDS);
    await prisma.igAccount.update({ where: { id: req.params.id }, data: { webhooksSubscribed: r.success === true } });
    return r;
  });

  /**
   * Analytics from data the basic permission allows: live profile counters, our daily follower
   * snapshots (growth), and likes/comments on the latest 25 posts (engagement, best posts).
   */
  /** Instagram profile counters (posts / followers / following) for the Posts page header. */
  app.get<{ Params: { id: string } }>("/accounts/:id/profile", async (req, reply) => {
    const ig = await igClientFor(req.params.id);
    if (!ig) return reply.code(404).send({ error: "not_found" });
    return cached<IgProfile>(redis(), keys.profile(req.params.id), 600, () => ig.profile());
  });

  app.get<{ Params: { id: string }; Querystring: { days?: string } }>("/accounts/:id/analytics", async (req, reply) => {
    const ig = await igClientFor(req.params.id);
    if (!ig) return reply.code(404).send({ error: "not_found" });
    const days = Math.min(Math.max(Number(req.query.days ?? 30) || 30, 7), 365);
    const since = utcDay(new Date(Date.now() - days * 24 * 3600 * 1000));

    const [profile, media, history] = await Promise.all([
      cached<IgProfile>(redis(), keys.profile(req.params.id), 600, () => ig.profile()),
      cached<IgMedia[]>(redis(), keys.media(req.params.id), 300, async () => (await ig.listMedia(25)).data),
      prisma.accountStat.findMany({
        where: { accountId: req.params.id, day: { gte: since } },
        orderBy: { day: "asc" },
        select: { day: true, followers: true, mediaCount: true },
      }),
    ]);
    const followers = profile.followers_count ?? history.at(-1)?.followers ?? 0;
    const posts = postStats(media, followers);
    const acc = await prisma.igAccount.findUnique({ where: { id: req.params.id }, select: { timezone: true } });
    const timezone = acc?.timezone ?? "Asia/Kolkata";
    const messages = await prisma.dmMessage.findMany({
      where: { accountId: req.params.id, createdAt: { gte: new Date(Date.now() - days * 24 * 3600 * 1000) } },
      select: { igsid: true, direction: true, createdAt: true },
    });
    return {
      days,
      summary: summarize(posts, followers, history),
      history,
      best: bestPosts(posts),
      bestTimes: bestTimes(posts, timezone),
      hashtags: hashtagPerformance(media, followers),
      dm: dmStats(messages),
      timezone,
      posts,
    };
  });

  /** Recent posts. Cached 5 min in Redis so opening the app doesn't burn API quota. */
  app.get<{ Params: { id: string }; Querystring: { fresh?: string; all?: string } }>("/accounts/:id/media", async (req, reply) => {
    const ig = await igClientFor(req.params.id);
    if (!ig) return reply.code(404).send({ error: "not_found" });
    // all=1: every post/reel on the account (rule picker, Instagram grid); otherwise the latest 25
    const all = req.query.all === "1";
    const key = all ? keys.mediaAll(req.params.id) : keys.media(req.params.id);
    if (req.query.fresh === "1") await invalidate(redis(), key);
    return all
      ? cached<IgMedia[]>(redis(), key, 600, () => ig.listAllMedia())
      : cached<IgMedia[]>(redis(), key, 300, async () => (await ig.listMedia(25)).data);
  });
}
