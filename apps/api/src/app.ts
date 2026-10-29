import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { createRedis, env, IgApiError, redis } from "@instaauto/core";
import { prisma } from "@instaauto/db";
import authRoutes from "./routes/auth.js";
import instagramRoutes from "./routes/instagram.js";
import webhookRoutes from "./routes/webhooks.js";
import accountRoutes from "./routes/accounts.js";
import ruleRoutes from "./routes/rules.js";
import postRoutes from "./routes/posts.js";
import miscRoutes from "./routes/misc.js";
import mediaRoutes from "./routes/media.js";
import privacyRoutes from "./routes/privacy.js";
import extraRoutes from "./routes/extras.js";
import commentRoutes from "./routes/comments.js";
import flowRoutes from "./routes/flows.js";

export async function buildServer() {
  env(); // fail fast on missing config
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info", redact: ["req.headers.cookie", "req.headers.authorization"] },
    trustProxy: true, // behind Render/Railway/Vercel proxies
    bodyLimit: 1024 * 1024,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie);
  // API-wide limit, counters shared across instances via Redis
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    redis: createRedis("ratelimit"),
    nameSpace: "ia:rl:http:",
  });

  app.get("/health", { config: { rateLimit: false } }, async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await redis().ping();
      return { ok: true };
    } catch (err) {
      return reply.code(503).send({ ok: false, error: (err as Error).message });
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    req.log.error({ err }, "request failed");
    // Instagram API errors are upstream errors: never 401 (that would log the user out of the PWA)
    if (err instanceof IgApiError) {
      return reply.code(502).send({ error: `Instagram: ${err.message}`, igCode: err.code });
    }
    // Prisma "record not found"
    if (err.code === "P2025") return reply.code(404).send({ error: "not_found" });
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    return reply.code(status).send({ error: status === 500 ? "internal_error" : err.message });
  });

  // Routes (registered after the error handler so they inherit it)
  await app.register(webhookRoutes); // own JSON parser (raw body), so registered in its own context
  await app.register(authRoutes);
  await app.register(instagramRoutes);
  await app.register(accountRoutes);
  await app.register(ruleRoutes);
  await app.register(postRoutes);
  await app.register(miscRoutes);
  await app.register(mediaRoutes); // own multipart parser
  await app.register(privacyRoutes); // public, needed by Meta to go Live
  await app.register(extraRoutes);
  await app.register(commentRoutes);
  await app.register(flowRoutes);


  return app;
}
