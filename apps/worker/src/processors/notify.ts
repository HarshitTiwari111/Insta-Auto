import type { Job } from "bullmq";
import { sendPush, type NotifyJob } from "@instaauto/core";
import { prisma } from "@instaauto/db";

/** Team app: every logged-in device that enabled notifications gets the alert. */
export async function processNotify(job: Job<NotifyJob>): Promise<void> {
  const subs = await prisma.pushSubscription.findMany();
  if (!subs.length) return;
  const gone = await sendPush(subs, job.data);
  if (gone.length) await prisma.pushSubscription.deleteMany({ where: { endpoint: { in: gone } } });
}
