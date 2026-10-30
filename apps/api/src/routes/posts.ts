import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { schedulePublish } from "@instaauto/core";
import { prisma } from "@instaauto/db";
import { requireAuth } from "../plugins/auth.js";
import { log, q } from "../ctx.js";

const Fields = z.object({
  accountId: z.string().min(1),
  type: z.enum(["IMAGE", "REELS", "STORY", "CAROUSEL"]),
  mediaUrls: z.array(z.string().url().startsWith("https://")).max(20),
  caption: z.string().max(2200).optional(),
  firstComment: z.string().max(2200).optional(),
  scheduledAt: z.coerce.date(),
  /** Auto-delete from Instagram at this time (after publishing) */
  deleteAt: z.coerce.date().nullable().optional(),
  /** true = save as DRAFT (not queued, relaxed checks) */
  draft: z.boolean().optional(),
});

/** Checks that only apply when the post is actually queued for publishing. */
const Schedulable = Fields.refine(
  (p) => (p.type === "CAROUSEL" ? p.mediaUrls.length >= 2 : p.mediaUrls.length === 1),
  { message: "CAROUSEL needs 2-20 URLs; other types need exactly 1" },
).refine((p) => p.scheduledAt.getTime() > Date.now() - 60_000, { message: "scheduledAt is in the past" })
  .refine((p) => !p.deleteAt || p.deleteAt.getTime() > p.scheduledAt.getTime(), { message: "Auto-delete time must be after the post time" });

function parse(body: unknown) {
  const raw = Fields.safeParse(body);
  if (!raw.success) return raw;
  return raw.data.draft ? raw : Schedulable.safeParse(body);
}

export default async function postRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  /** Optional from/to (ISO) for the calendar month view. */
  app.get<{ Querystring: { accountId?: string; from?: string; to?: string } }>("/posts", async (req) => {
    const { accountId, from, to } = req.query;
    const range = from && to ? { scheduledAt: { gte: new Date(from), lt: new Date(to) } } : {};
    return prisma.scheduledPost.findMany({
      where: { ...(accountId ? { accountId } : {}), ...range },
      orderBy: { scheduledAt: "desc" },
      take: from && to ? 500 : 100,
    });
  });

  app.post("/posts", async (req, reply) => {
    const body = parse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "invalid_body" });
    const { draft, ...data } = body.data;
    const post = await prisma.scheduledPost.create({
      data: { ...data, status: draft ? "DRAFT" : "PENDING", createdById: req.session!.userId },
    });
    if (draft) {
      await log(post.accountId, "post.draft_saved", { postId: post.id, by: req.session!.email });
    } else {
      await schedulePublish(q(), post.id, post.scheduledAt);
      await log(post.accountId, "post.scheduled", { postId: post.id, at: post.scheduledAt, by: req.session!.email });
    }
    return post;
  });

  /** Edit a DRAFT or PENDING post. `draft` moves it between the two states. */
  app.put<{ Params: { id: string } }>("/posts/:id", async (req, reply) => {
    const post = await prisma.scheduledPost.findUnique({ where: { id: req.params.id } });
    if (!post) return reply.code(404).send({ error: "not_found" });
    if (post.status !== "DRAFT" && post.status !== "PENDING") return reply.code(409).send({ error: `cannot edit ${post.status}` });
    const body = parse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "invalid_body" });
    const { draft, accountId: _ignored, ...data } = body.data;

    // Remove the old delayed job first; the worker also re-checks status before publishing
    await (await q().publish.getJob(post.id))?.remove().catch(() => undefined);
    const updated = await prisma.scheduledPost.update({
      where: { id: post.id },
      data: { ...data, caption: data.caption ?? null, firstComment: data.firstComment ?? null, deleteAt: data.deleteAt ?? null, status: draft ? "DRAFT" : "PENDING", error: null },
    });
    if (!draft) {
      await schedulePublish(q(), updated.id, updated.scheduledAt);
      if (post.status === "DRAFT") {
        await log(post.accountId, "post.scheduled", { postId: post.id, at: updated.scheduledAt, by: req.session!.email });
      }
    }
    return updated;
  });

  /** Only drafts are deleted; queued posts use cancel so the history stays. */
  app.delete<{ Params: { id: string } }>("/posts/:id", async (req, reply) => {
    const post = await prisma.scheduledPost.findUnique({ where: { id: req.params.id } });
    if (!post) return reply.code(404).send({ error: "not_found" });
    if (post.status !== "DRAFT") return reply.code(409).send({ error: "only drafts can be deleted; cancel scheduled posts instead" });
    await prisma.scheduledPost.delete({ where: { id: post.id } });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/posts/:id/cancel", async (req, reply) => {
    const post = await prisma.scheduledPost.findUnique({ where: { id: req.params.id } });
    if (!post) return reply.code(404).send({ error: "not_found" });
    if (post.status !== "PENDING") return reply.code(409).send({ error: `cannot cancel ${post.status}` });
    await (await q().publish.getJob(post.id))?.remove().catch(() => undefined);
    return prisma.scheduledPost.update({ where: { id: post.id }, data: { status: "CANCELLED" } });
  });

  /** Set or clear auto-delete on a scheduled or already published post. */
  app.patch<{ Params: { id: string } }>("/posts/:id/auto-delete", async (req, reply) => {
    const body = z.object({ deleteAt: z.coerce.date().nullable() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    const post = await prisma.scheduledPost.findUnique({ where: { id: req.params.id } });
    if (!post) return reply.code(404).send({ error: "not_found" });
    if (post.deletedAt || !["DRAFT", "PENDING", "PUBLISHING", "PUBLISHED"].includes(post.status)) {
      return reply.code(409).send({ error: `cannot auto-delete a ${post.deletedAt ? "deleted" : post.status.toLowerCase()} post` });
    }
    const { deleteAt } = body.data;
    if (deleteAt && deleteAt.getTime() <= Math.max(Date.now(), post.scheduledAt.getTime())) {
      return reply.code(400).send({ error: "Auto-delete time must be in the future and after the post time" });
    }
    const updated = await prisma.scheduledPost.update({ where: { id: post.id }, data: { deleteAt } });
    await log(post.accountId, deleteAt ? "post.auto_delete_set" : "post.auto_delete_cleared", { postId: post.id, at: deleteAt, by: req.session!.email });
    return updated;
  });

  app.post<{ Params: { id: string } }>("/posts/:id/retry", async (req, reply) => {
    const post = await prisma.scheduledPost.findUnique({ where: { id: req.params.id } });
    if (!post) return reply.code(404).send({ error: "not_found" });
    if (post.status !== "FAILED") return reply.code(409).send({ error: `cannot retry ${post.status}` });
    const updated = await prisma.scheduledPost.update({
      where: { id: post.id },
      data: { status: "PENDING", error: null, scheduledAt: new Date() },
    });
    await schedulePublish(q(), post.id, new Date());
    return updated;
  });
}
