import { Worker } from "bullmq";
import { configurePush, createRedis, env, logger, QUEUE } from "@instaauto/core";
import { prisma } from "@instaauto/db";
import { processEvent } from "./processors/events.js";
import { processPublish } from "./processors/publish.js";
import { processMaintenance } from "./processors/maintenance.js";
import { processNotify } from "./processors/notify.js";
import { q } from "./shared.js";

const e = env();
const pushOn = configurePush(e.VAPID_PUBLIC_KEY, e.VAPID_PRIVATE_KEY, e.VAPID_SUBJECT);
if (!pushOn) logger.warn("VAPID keys missing: push notifications disabled");

// Each Worker needs its own blocking Redis connection
const workers = [
  new Worker(QUEUE.events, processEvent, { connection: createRedis("w-events"), concurrency: 10 }),
  new Worker(QUEUE.publish, processPublish, { connection: createRedis("w-publish"), concurrency: 2 }),
  new Worker(QUEUE.maintenance, processMaintenance, { connection: createRedis("w-maint"), concurrency: 1 }),
  new Worker(QUEUE.notify, processNotify, { connection: createRedis("w-notify"), concurrency: 5 }),
];

for (const w of workers) {
  w.on("failed", (job, err) => logger.error({ queue: w.name, jobId: job?.id, attempts: job?.attemptsMade, err: err.message }, "job failed"));
  w.on("error", (err) => logger.error({ queue: w.name, err: err.message }, "worker error"));
}

// Repeatable jobs (idempotent: upsert by scheduler id, safe on every boot / multiple workers)
const m = q().maintenance;
await m.upsertJobScheduler("refresh-tokens", { pattern: "0 3 * * *" }, { name: "refresh-tokens", data: { task: "refresh-tokens" } });
await m.upsertJobScheduler("sweep-posts", { every: 5 * 60_000 }, { name: "sweep-posts", data: { task: "sweep-posts" } });
await m.upsertJobScheduler("cleanup", { pattern: "30 4 * * *" }, { name: "cleanup", data: { task: "cleanup" } });
await m.upsertJobScheduler("snapshot-stats", { pattern: "5 * * * *" }, { name: "snapshot-stats", data: { task: "snapshot-stats" } });
await m.add("snapshot-stats", { task: "snapshot-stats" }); // fresh numbers right after boot
// Reports at 09:00 IST (03:30 UTC): weekly on Mondays, monthly on the 1st
await m.upsertJobScheduler("report-weekly", { pattern: "30 3 * * 1" }, { name: "report-weekly", data: { task: "report", period: "weekly" } });
await m.upsertJobScheduler("report-monthly", { pattern: "30 3 1 * *" }, { name: "report-monthly", data: { task: "report", period: "monthly" } });
if (e.COMMENT_POLL_MINUTES > 0) {
  await m.upsertJobScheduler(
    "poll-comments",
    { every: e.COMMENT_POLL_MINUTES * 60_000 },
    { name: "poll-comments", data: { task: "poll-comments" } },
  );
} else {
  await m.removeJobScheduler("poll-comments");
}

logger.info({ queues: workers.map((w) => w.name), commentPollMinutes: e.COMMENT_POLL_MINUTES }, "worker started");

const shutdown = async () => {
  logger.info("shutting down worker");
  await Promise.all(workers.map((w) => w.close()));
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
