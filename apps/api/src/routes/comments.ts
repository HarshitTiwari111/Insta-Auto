import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { cached, invalidate, keys, redis, type IgComment, type IgMedia } from "@instaauto/core";
import { requireAuth } from "../plugins/auth.js";
import { igClientFor, log } from "../ctx.js";

const commentsKey = (accountId: string) => `ia:cache:comments:${accountId}`;

export interface ModComment {
  id: string;
  text: string;
  username: string | null;
  timestamp: string | null;
  hidden: boolean;
  likes: number;
  mediaId: string;
  mediaCaption: string;
  mediaThumb: string | null;
  permalink: string | null;
}

const AccountBody = z.object({ accountId: z.string().min(1) });
const ReplyBody = AccountBody.extend({ message: z.string().trim().min(1).max(2200) });
const HideBody = AccountBody.extend({ hide: z.boolean() });
const LikeBody = AccountBody.extend({ like: z.boolean() });

/** Comment moderation: latest comments on the latest posts, with hide / delete / reply. */
export default async function commentRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get<{ Params: { id: string }; Querystring: { fresh?: string } }>("/accounts/:id/comments", async (req, reply) => {
    const ig = await igClientFor(req.params.id);
    if (!ig) return reply.code(404).send({ error: "not_found" });
    if (req.query.fresh === "1") await invalidate(redis(), commentsKey(req.params.id));
    return cached<ModComment[]>(redis(), commentsKey(req.params.id), 60, async () => {
      const media = await cached<IgMedia[]>(redis(), keys.media(req.params.id), 300, async () => (await ig.listMedia(25)).data);
      const withComments = media.filter((m) => (m.comments_count ?? 0) > 0).slice(0, 10);
      const lists = await Promise.all(withComments.map((m) => ig.listComments(m.id, 50).then((r) => ({ m, list: r.data as IgComment[] }))));
      return lists
        .flatMap(({ m, list }) =>
          list.map((c) => ({
            id: c.id,
            text: c.text ?? "",
            username: c.from?.username ?? c.username ?? null,
            timestamp: c.timestamp ?? null,
            hidden: Boolean(c.hidden),
            likes: c.like_count ?? 0,
            mediaId: m.id,
            mediaCaption: (m.caption ?? "").slice(0, 80),
            mediaThumb: m.thumbnail_url ?? m.media_url ?? null,
            permalink: m.permalink ?? null,
          })),
        )
        .sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
    });
  });

  /** All comments on one post (in-app post viewer). Not cached: opened rarely, must show fresh state. */
  app.get<{ Params: { id: string; mediaId: string } }>("/accounts/:id/media/:mediaId/comments", async (req, reply) => {
    const ig = await igClientFor(req.params.id);
    if (!ig) return reply.code(404).send({ error: "not_found" });
    const { data } = await ig.listCommentsWithReplies(req.params.mediaId, 100);
    const liked = new Set(await redis().smembers(keys.likedComments(req.params.id)));
    const shape = (c: IgComment) => ({
      id: c.id,
      text: c.text ?? "",
      username: c.from?.username ?? c.username ?? null,
      timestamp: c.timestamp ?? null,
      hidden: Boolean(c.hidden),
      likes: c.like_count ?? 0,
      liked: liked.has(c.id),
    });
    const byTime = (a: { timestamp: string | null }, b: { timestamp: string | null }) => (a.timestamp ?? "").localeCompare(b.timestamp ?? "");
    return data
      .map((c) => ({ ...shape(c), replies: (c.replies?.data ?? []).map(shape).sort(byTime) }))
      .sort(byTime);
  });

  app.post<{ Params: { commentId: string } }>("/comments/:commentId/hide", async (req, reply) => {
    const body = HideBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    const ig = await igClientFor(body.data.accountId);
    if (!ig) return reply.code(404).send({ error: "not_found" });
    await ig.setCommentHidden(req.params.commentId, body.data.hide);
    await invalidate(redis(), commentsKey(body.data.accountId));
    await log(body.data.accountId, body.data.hide ? "comment.hide" : "comment.unhide", { commentId: req.params.commentId, by: req.session!.email });
    return { ok: true };
  });

  app.post<{ Params: { commentId: string } }>("/comments/:commentId/like", async (req, reply) => {
    const body = LikeBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    const ig = await igClientFor(body.data.accountId);
    if (!ig) return reply.code(404).send({ error: "not_found" });
    await ig.likeComment(req.params.commentId, body.data.like);
    const set = keys.likedComments(body.data.accountId);
    await (body.data.like ? redis().sadd(set, req.params.commentId) : redis().srem(set, req.params.commentId));
    await log(body.data.accountId, body.data.like ? "comment.like" : "comment.unlike", { commentId: req.params.commentId, by: req.session!.email });
    return { ok: true };
  });

  app.post<{ Params: { commentId: string } }>("/comments/:commentId/reply", async (req, reply) => {
    const body = ReplyBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "invalid_body" });
    const ig = await igClientFor(body.data.accountId);
    if (!ig) return reply.code(404).send({ error: "not_found" });
    const r = await ig.replyToComment(req.params.commentId, body.data.message);
    await invalidate(redis(), commentsKey(body.data.accountId));
    await log(body.data.accountId, "comment.manual_reply", { commentId: req.params.commentId, reply: body.data.message, by: req.session!.email });
    return { id: r.id };
  });

  app.post<{ Params: { commentId: string } }>("/comments/:commentId/delete", async (req, reply) => {
    const body = AccountBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    const ig = await igClientFor(body.data.accountId);
    if (!ig) return reply.code(404).send({ error: "not_found" });
    await ig.deleteComment(req.params.commentId);
    await invalidate(redis(), commentsKey(body.data.accountId));
    await log(body.data.accountId, "comment.delete", { commentId: req.params.commentId, by: req.session!.email });
    return { ok: true };
  });
}
