import type { FastifyInstance } from "fastify";
import { env, keys, logger, markOnce, normalizeWebhook, redis, verifySignature } from "@instaauto/core";
import { prisma } from "@instaauto/db";
import { q } from "../ctx.js";

/**
 * Meta webhook endpoint. Rules from the docs:
 *  - GET verification: echo hub.challenge when hub.verify_token matches
 *  - POST: verify X-Hub-Signature-256, answer 200 fast, do slow work later (queue)
 *  - Meta retries for up to 36h, so dedupe
 */
export default async function webhookRoutes(app: FastifyInstance) {
  // Keep the raw bytes: the HMAC must be computed over the exact body Meta sent.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  app.get<{ Querystring: Record<string, string> }>("/webhooks/instagram", async (req, reply) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === env().IG_WEBHOOK_VERIFY_TOKEN && challenge) {
      return reply.type("text/plain").send(challenge);
    }
    return reply.code(403).send("forbidden");
  });

  app.post("/webhooks/instagram", { config: { rateLimit: false } }, async (req, reply) => {
    const raw = req.body as Buffer;
    const sig = req.headers["x-hub-signature-256"] as string | undefined;
    if (!Buffer.isBuffer(raw) || !verifySignature(raw, sig, env().IG_APP_SECRET)) {
      logger.warn({ hasSig: Boolean(sig) }, "webhook signature rejected");
      return reply.code(401).send();
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      return reply.code(400).send();
    }

    const events = normalizeWebhook(payload);
    for (const event of events) {
      // Fast dedupe in Redis (Meta retry window is 36h, keep 48h)
      if (!(await markOnce(redis(), keys.dedupe(event.dedupeKey), 48 * 3600))) continue;
      await prisma.webhookEvent
        .create({
          data: {
            igUserId: event.igUserId,
            field: event.kind,
            dedupeKey: event.dedupeKey,
            payload: event as object,
          },
        })
        .catch(() => undefined); // unique violation = already stored
      try {
        await q().events.add(event.kind, { event }, { jobId: event.dedupeKey.replace(/:/g, "_") });
      } catch (err) {
        // Let Meta retry this delivery instead of silently losing the event
        await redis().del(keys.dedupe(event.dedupeKey));
        throw err;
      }
    }
    return reply.code(200).send("EVENT_RECEIVED");
  });
}
