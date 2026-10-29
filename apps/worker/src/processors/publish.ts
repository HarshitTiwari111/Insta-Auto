import { UnrecoverableError, type Job } from "bullmq";
import {
  acquireLock,
  currentMediaUrl,
  IgApiError,
  keys,
  logger,
  redis,
  type ContainerStatus,
  type IgClient,
  type PublishJob,
} from "@instaauto/core";
import { prisma, type ScheduledPost } from "@instaauto/db";
import { igFor, log, notify, sleep } from "../shared.js";

const isVideoUrl = (u: string) => /\.(mp4|mov)(\?|$)/i.test(u);

/**
 * Publish flow (Meta docs, Content Publishing):
 *  1. POST /<IG_ID>/media           -> container id (carousel: one per item + parent)
 *  2. GET  /<CONTAINER_ID>?fields=status_code until FINISHED
 *     (docs: check once per minute, for no more than 5 minutes)
 *  3. POST /<IG_ID>/media_publish   creation_id=<container>
 */
export async function processPublish(job: Job<PublishJob>): Promise<void> {
  const release = await acquireLock(redis(), keys.lock(`publish:${job.data.postId}`), 60 * 60_000);
  if (!release) return; // another worker is on it
  try {
    const post = await prisma.scheduledPost.findUnique({ where: { id: job.data.postId }, include: { account: true } });
    if (!post || (post.status !== "PENDING" && post.status !== "PUBLISHING")) return;
    if (post.account.paused) {
      await fail(post, "Account is paused (emergency stop)");
      throw new UnrecoverableError("account paused");
    }

    await prisma.scheduledPost.update({ where: { id: post.id }, data: { status: "PUBLISHING" } });
    const ig = igFor(post.account);

    await checkQuota(ig, post);
    const creationId = await createContainers(ig, post);
    await waitFinished(ig, creationId);
    const published = await ig.publishContainer(creationId);

    await prisma.scheduledPost.update({
      where: { id: post.id },
      data: { status: "PUBLISHED", igMediaId: published.id, error: null },
    });
    await redis().del(keys.media(post.accountId)); // refresh cached media list
    await log(post.accountId, "post.published", { postId: post.id, igMediaId: published.id, type: post.type });
    // Stories can't have comments. A failed first comment must not fail an already-published post.
    if (post.firstComment?.trim() && post.type !== "STORY") {
      try {
        await ig.commentOnMedia(published.id, post.firstComment.trim());
        await log(post.accountId, "post.first_comment", { postId: post.id, igMediaId: published.id });
      } catch (err) {
        logger.warn({ err: (err as Error).message, postId: post.id }, "first comment failed");
        await log(post.accountId, "error.first_comment", { postId: post.id, message: (err as Error).message });
      }
    }
    await notify("Post published", `@${post.account.username}: ${post.type.toLowerCase()} is live`, "/posts");
  } catch (err) {
    const attemptsLeft = (job.opts.attempts ?? 1) - job.attemptsMade - 1;
    const unrecoverable =
      err instanceof UnrecoverableError || (err instanceof IgApiError && (err.isAuthError || err.status === 400));
    if (unrecoverable || attemptsLeft <= 0) {
      const post = await prisma.scheduledPost.findUnique({ where: { id: job.data.postId }, include: { account: true } });
      if (post && post.status !== "FAILED") {
        await fail(post, (err as Error).message);
        await notify("Post failed", `@${post.account.username}: ${(err as Error).message.slice(0, 120)}`, "/posts");
      }
      if (!(err instanceof UnrecoverableError)) throw new UnrecoverableError((err as Error).message);
    }
    throw err;
  } finally {
    await release();
  }
}

async function fail(post: ScheduledPost, message: string) {
  await prisma.scheduledPost.update({ where: { id: post.id }, data: { status: "FAILED", error: message.slice(0, 1000) } });
  await log(post.accountId, "post.failed", { postId: post.id, error: message.slice(0, 500) });
}

/** Read the live quota instead of hard-coding it (Meta docs show both 100 and 50). */
async function checkQuota(ig: IgClient, post: ScheduledPost) {
  try {
    const r = await ig.publishingLimit();
    const row = r.data[0];
    const total = row?.config?.quota_total;
    if (row && total !== undefined && row.quota_usage >= total) {
      throw new Error(`Publishing limit reached (${row.quota_usage}/${total} in 24h)`);
    }
  } catch (err) {
    if (err instanceof IgApiError) {
      // Endpoint unavailable for this login type / version: don't block, Meta enforces the limit anyway
      logger.warn({ err: err.message, postId: post.id }, "content_publishing_limit check skipped");
      return;
    }
    throw err;
  }
}

async function createContainers(ig: IgClient, post: ScheduledPost): Promise<string> {
  const caption = post.caption ?? undefined;
  // Our uploads may carry an old tunnel hostname: point them at the current API_PUBLIC_URL
  const mediaUrls = post.mediaUrls.map(currentMediaUrl);
  const [first] = mediaUrls;
  if (!first) throw new UnrecoverableError("no media URL");

  switch (post.type) {
    case "IMAGE":
      return (await ig.createContainer({ image_url: first, caption })).id;
    case "REELS":
      return (await ig.createContainer({ media_type: "REELS", video_url: first, caption })).id;
    case "STORY":
      return (
        await ig.createContainer(
          isVideoUrl(first) ? { media_type: "STORIES", video_url: first } : { media_type: "STORIES", image_url: first },
        )
      ).id;
    case "CAROUSEL": {
      const children: string[] = [];
      for (const url of mediaUrls) {
        const c = await ig.createContainer(
          isVideoUrl(url)
            ? { is_carousel_item: true, media_type: "VIDEO", video_url: url }
            : { is_carousel_item: true, image_url: url },
        );
        await waitFinished(ig, c.id);
        children.push(c.id);
      }
      return (await ig.createContainer({ media_type: "CAROUSEL", children: children.join(","), caption })).id;
    }
  }
}

async function waitFinished(ig: IgClient, containerId: string): Promise<void> {
  for (let i = 0; i <= 5; i++) {
    const { status_code } = await ig.containerStatus(containerId);
    if (status_code === "FINISHED" || status_code === "PUBLISHED") return;
    if (status_code === "ERROR" || status_code === "EXPIRED") {
      throw new UnrecoverableError(`Container ${containerId} status ${status_code satisfies ContainerStatus}`);
    }
    if (i < 5) await sleep(60_000);
  }
  throw new Error(`Container ${containerId} still processing after 5 minutes`);
}
