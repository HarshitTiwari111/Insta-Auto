import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { clampUtf8, env, IgApiError, keys, redis, utcDay } from "@instaauto/core";
import { prisma } from "@instaauto/db";
import { requireAuth } from "../plugins/auth.js";
import { igClientFor, log, q } from "../ctx.js";

/** Meta: standard messaging window = 24h after the person's last message. */
const DM_WINDOW_MS = 24 * 3600 * 1000;

const SendBody = z.object({
  igsid: z.string().min(1),
  text: z.string().trim().min(1).max(1000),
});

const SubBody = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

export default async function miscRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/dashboard", async () => {
    const day = utcDay();
    const [accounts, activeRules, pendingPosts, failedPosts, recent] = await Promise.all([
      prisma.igAccount.findMany({ select: { id: true, username: true, profilePictureUrl: true, paused: true, dailyActionLimit: true } }),
      prisma.automationRule.count({ where: { enabled: true } }),
      prisma.scheduledPost.count({ where: { status: "PENDING" } }),
      prisma.scheduledPost.count({ where: { status: "FAILED" } }),
      prisma.activityLog.findMany({ orderBy: { createdAt: "desc" }, take: 15, include: { account: { select: { username: true } } } }),
    ]);
    const used = accounts.length ? await redis().mget(...accounts.map((a) => keys.dailyActions(a.id, day))) : [];
    return {
      accounts: accounts.map((a, i) => ({ ...a, actionsToday: Number(used[i] ?? 0) })),
      activeRules,
      pendingPosts,
      failedPosts,
      recent,
    };
  });

  app.get<{ Querystring: { accountId?: string; limit?: string } }>("/activity", async (req) =>
    prisma.activityLog.findMany({
      where: req.query.accountId ? { accountId: req.query.accountId } : {},
      orderBy: { createdAt: "desc" },
      take: Math.min(Number(req.query.limit ?? 100), 500),
      include: { account: { select: { username: true } } },
    }),
  );

  /** Latest messages; the PWA groups them into conversations. */
  app.get<{ Params: { id: string } }>("/accounts/:id/messages", async (req) =>
    prisma.dmMessage.findMany({
      where: { accountId: req.params.id },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
  );

  /** Manual reply typed by a team member. Not automation, so no daily budget / pause check. */
  app.post<{ Params: { id: string } }>("/accounts/:id/messages", async (req, reply) => {
    const body = SendBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "invalid_body" });
    const { igsid } = body.data;

    const lastIn = await prisma.dmMessage.findFirst({
      where: { accountId: req.params.id, igsid, direction: "IN" },
      orderBy: { createdAt: "desc" },
    });
    if (!lastIn || Date.now() - lastIn.createdAt.getTime() > DM_WINDOW_MS) {
      return reply.code(409).send({ error: "24h window closed: Instagram only allows a reply within 24 hours of their last message" });
    }

    const ig = await igClientFor(req.params.id);
    if (!ig) return reply.code(404).send({ error: "not_found" });

    const text = clampUtf8(body.data.text);
    try {
      const r = await ig.sendText(igsid, text);
      // The echo webhook carries the same mid, so upsert keeps one row
      const msg = await prisma.dmMessage.upsert({
        where: { mid: r.message_id },
        create: { accountId: req.params.id, igsid, username: lastIn.username, direction: "OUT", text, mid: r.message_id },
        update: {},
      });
      await log(req.params.id, "dm.manual", { to: igsid, by: req.session!.email, reply: text });
      return msg;
    } catch (err) {
      // Not 401: the PWA treats 401 as "app session expired" and redirects to /login
      if (err instanceof IgApiError && err.isAuthError) return reply.code(502).send({ error: "Instagram token rejected: reconnect the account in Settings" });
      if (err instanceof IgApiError) return reply.code(502).send({ error: `Instagram: ${err.message}` });
      req.log.error({ err }, "dm send failed");
      return reply.code(502).send({ error: "Could not reach Instagram. Check the server's internet / TLS settings and try again." });
    }
  });

  // ---------- Web Push ----------

  app.get("/push/public-key", async () => ({ key: env().VAPID_PUBLIC_KEY || null }));

  app.post("/push/subscribe", async (req, reply) => {
    const body = SubBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    const { endpoint, keys: k } = body.data;
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { endpoint, p256dh: k.p256dh, auth: k.auth, userId: req.session!.userId },
      update: { p256dh: k.p256dh, auth: k.auth, userId: req.session!.userId },
    });
    return { ok: true };
  });

  app.post("/push/unsubscribe", async (req) => {
    const endpoint = (req.body as { endpoint?: string } | undefined)?.endpoint;
    if (endpoint) await prisma.pushSubscription.deleteMany({ where: { endpoint } });
    return { ok: true };
  });

  app.post("/push/test", async () => {
    await q().notify.add("test", { title: "Instaauto", body: "Push notifications are working", url: "/" });
    return { ok: true };
  });
}
