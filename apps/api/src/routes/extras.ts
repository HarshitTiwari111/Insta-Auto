import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AiError,
  bestPosts,
  cached,
  classifySentiment,
  contentIdeas,
  env,
  generateCaption,
  IgApiError,
  invalidate,
  keys,
  postStats,
  redis,
  uploadedMediaName,
  type IgMedia,
  type IgProfile,
} from "@instaauto/core";
import { prisma } from "@instaauto/db";
import { requireAuth } from "../plugins/auth.js";
import { igClientFor, log } from "../ctx.js";
import { readMediaBuffer } from "../media-store.js";

const CaptionBody = z.object({
  accountId: z.string().min(1),
  notes: z.string().max(2000).default(""),
  imageUrl: z.string().url().optional(),
});

const HashtagBody = z.object({
  name: z.string().trim().min(1).max(60),
  tags: z.string().trim().min(1).max(2200),
});

/** Rule fields that are safe to export / import (no ids, no account link). */
const RuleExport = z.object({
  name: z.string().min(1).max(100),
  enabled: z.boolean(),
  trigger: z.enum(["COMMENT", "DM"]),
  matchType: z.enum(["ANY", "KEYWORD"]),
  keywords: z.array(z.string()).max(50),
  replyTemplates: z.array(z.string()).max(20),
  privateReplyTemplates: z.array(z.string()).max(20),
  hideComment: z.boolean(),
  deleteComment: z.boolean().default(false),
  aiReply: z.boolean().default(false),
  aiInstructions: z.string().nullable().default(null),
  quickReplies: z.array(z.string()).max(13).default([]),
  replyMediaUrl: z.string().nullable().default(null),
  priority: z.number().int(),
});

const RestoreBody = z.object({
  accountId: z.string().min(1),
  backup: z.object({
    version: z.literal(1),
    rules: z.array(RuleExport).max(500),
    hashtagSets: z.array(HashtagBody).max(200).default([]),
    settings: z
      .object({
        dailyActionLimit: z.number().int().min(0).max(100_000),
        hourlyActionLimit: z.number().int().min(1).max(10_000),
        workStartHour: z.number().int().min(0).max(23).nullable(),
        workEndHour: z.number().int().min(0).max(23).nullable(),
        timezone: z.string().min(1).max(64),
        blocklist: z.array(z.string().max(30)).max(1000).optional(),
        blocklistHide: z.boolean().optional(),
      })
      .optional(),
  }),
});

export default async function extraRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  /** AI caption + hashtags. Uses the photo when it's one of our uploads, and the account's AI business info. */
  app.post("/ai/caption", async (req, reply) => {
    const body = CaptionBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "invalid_body" });
    const e = env();
    if (!e.GEMINI_API_KEY) return reply.code(400).send({ error: "AI is off: set GEMINI_API_KEY in the server .env" });

    let image: { mimeType: string; base64: string } | undefined;
    const name = body.data.imageUrl ? uploadedMediaName(body.data.imageUrl) : null;
    if (name?.endsWith(".jpg")) {
      const buf = await readMediaBuffer(name);
      if (buf) image = { mimeType: "image/jpeg", base64: buf.toString("base64") };
    }
    const withInfo = await prisma.automationRule.findFirst({
      where: { accountId: body.data.accountId, aiInstructions: { not: null } },
      select: { aiInstructions: true },
    });
    try {
      const caption = await generateCaption({
        apiKey: e.GEMINI_API_KEY,
        model: e.GEMINI_MODEL,
        notes: body.data.notes,
        businessInfo: withInfo?.aiInstructions ?? undefined,
        image,
      });
      return { caption };
    } catch (err) {
      if (err instanceof AiError) return reply.code(502).send({ error: `${err.message}. Try again in a minute.` });
      throw err;
    }
  });

  /** Sentiment labels for up to 100 texts (comments / messages). */
  app.post("/ai/sentiment", async (req, reply) => {
    const body = z.object({ texts: z.array(z.string().max(2000)).min(1).max(100) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    const e = env();
    if (!e.GEMINI_API_KEY) return reply.code(400).send({ error: "AI is off: set GEMINI_API_KEY in the server .env" });
    try {
      return { labels: await classifySentiment({ apiKey: e.GEMINI_API_KEY, model: e.GEMINI_MODEL, texts: body.data.texts }) };
    } catch (err) {
      if (err instanceof AiError) return reply.code(502).send({ error: `${err.message}. Try again in a minute.` });
      throw err;
    }
  });

  /** Post ideas from the business info (AI rules) and what worked on this account. */
  app.post("/ai/ideas", async (req, reply) => {
    const body = z.object({ accountId: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    const e = env();
    if (!e.GEMINI_API_KEY) return reply.code(400).send({ error: "AI is off: set GEMINI_API_KEY in the server .env" });
    const ig = await igClientFor(body.data.accountId);
    if (!ig) return reply.code(404).send({ error: "not_found" });
    const media = await cached<IgMedia[]>(redis(), keys.media(body.data.accountId), 300, async () => (await ig.listMedia(25)).data);
    const info = await prisma.automationRule.findFirst({
      where: { accountId: body.data.accountId, aiInstructions: { not: null } },
      select: { aiInstructions: true },
    });
    const posts = postStats(media, 1);
    try {
      const ideas = await contentIdeas({
        apiKey: e.GEMINI_API_KEY,
        model: e.GEMINI_MODEL,
        businessInfo: info?.aiInstructions ?? "",
        recentCaptions: media.map((m) => m.caption ?? "").filter(Boolean),
        bestCaptions: bestPosts(posts).map((p) => p.caption).filter(Boolean),
      });
      return { ideas };
    } catch (err) {
      if (err instanceof AiError) return reply.code(502).send({ error: `${err.message}. Try again in a minute.` });
      throw err;
    }
  });

  /** Competitor numbers via Business Discovery (their account must be Business/Creator). */
  app.get<{ Params: { id: string }; Querystring: { username?: string } }>("/accounts/:id/competitor", async (req, reply) => {
    const username = (req.query.username ?? "").replace(/^@/, "").trim();
    if (!/^[A-Za-z0-9._]{1,30}$/.test(username)) return reply.code(400).send({ error: "Enter a valid Instagram username" });
    const ig = await igClientFor(req.params.id);
    if (!ig) return reply.code(404).send({ error: "not_found" });
    if (!ig.pageId) return reply.code(400).send({ error: "Competitor analysis needs the Facebook Login connection" });
    try {
      const [r, mine] = await Promise.all([
        cached(redis(), `ia:cache:competitor:${username.toLowerCase()}`, 3600, () => ig.businessDiscovery(username)),
        cached<IgProfile>(redis(), keys.profile(req.params.id), 600, () => ig.profile()),
      ]);
      const bd = r.business_discovery;
      if (!bd) return reply.code(404).send({ error: "Account not found or not a Business/Creator account" });
      const followers = bd.followers_count ?? 0;
      const posts = postStats(bd.media?.data ?? [], followers);
      const avg = (f: (p: (typeof posts)[number]) => number) => (posts.length ? Math.round((posts.reduce((s, p) => s + f(p), 0) / posts.length) * 100) / 100 : 0);
      return {
        username: bd.username,
        name: bd.name ?? null,
        picture: bd.profile_picture_url ?? null,
        followers,
        mediaCount: bd.media_count ?? 0,
        avgLikes: avg((p) => p.likes),
        avgComments: avg((p) => p.comments),
        avgEngagementRate: avg((p) => p.engagementRate),
        recent: posts.slice(0, 6),
        mine: { followers: mine.followers_count ?? 0, mediaCount: mine.media_count ?? 0 },
      };
    } catch (err) {
      // #10: Meta hasn't granted Business Discovery to this app yet (needs App Review)
      if (err instanceof IgApiError && err.code === 10) {
        return reply.code(403).send({ error: "Meta has not approved competitor lookups (Business Discovery) for this app yet. It needs App Review." });
      }
      if (err instanceof IgApiError) return reply.code(404).send({ error: `Instagram: ${err.message}` });
      throw err;
    }
  });

  // ---------- Hashtag sets (team-wide) ----------

  app.get("/hashtag-sets", async () => prisma.hashtagSet.findMany({ orderBy: { createdAt: "asc" } }));

  app.post("/hashtag-sets", async (req, reply) => {
    const body = HashtagBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "invalid_body" });
    return prisma.hashtagSet.create({ data: body.data });
  });

  app.delete<{ Params: { id: string } }>("/hashtag-sets/:id", async (req) => {
    await prisma.hashtagSet.delete({ where: { id: req.params.id } });
    return { ok: true };
  });

  // ---------- Backup / restore (rules, hashtag sets, account limits) ----------

  app.get<{ Querystring: { accountId: string } }>("/backup", async (req, reply) => {
    const acc = await prisma.igAccount.findUnique({ where: { id: req.query.accountId } });
    if (!acc) return reply.code(404).send({ error: "not_found" });
    const rules = await prisma.automationRule.findMany({ where: { accountId: acc.id }, orderBy: { priority: "asc" } });
    const hashtagSets = await prisma.hashtagSet.findMany({ orderBy: { createdAt: "asc" } });
    return {
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      account: acc.username,
      settings: {
        dailyActionLimit: acc.dailyActionLimit,
        hourlyActionLimit: acc.hourlyActionLimit,
        workStartHour: acc.workStartHour,
        workEndHour: acc.workEndHour,
        timezone: acc.timezone,
        blocklist: acc.blocklist,
        blocklistHide: acc.blocklistHide,
      },
      rules: rules.map((r) => RuleExport.parse(r)),
      hashtagSets: hashtagSets.map(({ name, tags }) => ({ name, tags })),
    };
  });

  /** Adds the backup's rules and hashtag sets (existing ones with the same name are skipped) and applies its limits. */
  app.post("/restore", async (req, reply) => {
    const body = RestoreBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: `Not a valid backup file: ${body.error.issues[0]?.message ?? ""}` });
    const { accountId, backup } = body.data;
    const acc = await prisma.igAccount.findUnique({ where: { id: accountId } });
    if (!acc) return reply.code(404).send({ error: "not_found" });

    const existingRules = new Set((await prisma.automationRule.findMany({ where: { accountId }, select: { name: true } })).map((r) => r.name));
    const newRules = backup.rules.filter((r) => !existingRules.has(r.name));
    if (newRules.length) await prisma.automationRule.createMany({ data: newRules.map((r) => ({ ...r, accountId })) });

    const existingSets = new Set((await prisma.hashtagSet.findMany({ select: { name: true } })).map((s) => s.name));
    const newSets = backup.hashtagSets.filter((s) => !existingSets.has(s.name));
    if (newSets.length) await prisma.hashtagSet.createMany({ data: newSets });

    if (backup.settings) await prisma.igAccount.update({ where: { id: accountId }, data: backup.settings });
    await invalidate(redis(), keys.rules(accountId, "COMMENT"), keys.rules(accountId, "DM"));
    await log(accountId, "backup.restored", { by: req.session!.email, rules: newRules.length, hashtagSets: newSets.length });
    return { rules: newRules.length, skippedRules: backup.rules.length - newRules.length, hashtagSets: newSets.length };
  });
}
