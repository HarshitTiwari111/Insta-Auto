import { Queue, type JobsOptions } from "bullmq";
import type { Redis } from "ioredis";
import type { NormalizedEvent } from "./ig/webhook.js";

export const QUEUE = {
  events: "events", // webhook + polled comments/messages
  publish: "publish", // scheduled posts (delayed jobs)
  maintenance: "maintenance", // token refresh, sweeps, polling, cleanup
  notify: "notify", // web push fan-out
} as const;

export interface EventJob {
  event: NormalizedEvent;
}
export interface PublishJob {
  postId: string;
}
export type MaintenanceJob =
  | { task: "refresh-tokens" }
  | { task: "sweep-posts" }
  | { task: "poll-comments" }
  | { task: "cleanup" }
  | { task: "snapshot-stats" };
export interface NotifyJob {
  title: string;
  body: string;
  url?: string;
}

export const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 5000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

export function createQueues(connection: Redis) {
  return {
    events: new Queue<EventJob>(QUEUE.events, { connection, defaultJobOptions }),
    publish: new Queue<PublishJob>(QUEUE.publish, {
      connection,
      defaultJobOptions: { ...defaultJobOptions, attempts: 3, backoff: { type: "exponential", delay: 60_000 } },
    }),
    maintenance: new Queue<MaintenanceJob>(QUEUE.maintenance, { connection, defaultJobOptions: { attempts: 1 } }),
    notify: new Queue<NotifyJob>(QUEUE.notify, { connection, defaultJobOptions: { attempts: 3 } }),
  };
}

export type Queues = ReturnType<typeof createQueues>;

/** Delayed job for a scheduled post. jobId = postId so it can be found/removed later. */
export async function schedulePublish(queues: Queues, postId: string, scheduledAt: Date): Promise<void> {
  const delay = Math.max(0, scheduledAt.getTime() - Date.now());
  const existing = await queues.publish.getJob(postId);
  if (existing) await existing.remove().catch(() => undefined);
  await queues.publish.add("publish", { postId }, { jobId: postId, delay });
}
