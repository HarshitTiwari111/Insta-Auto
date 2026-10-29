import { clientForAccount, createQueues, createRedis, decrypt, env, type IgClient, type Queues } from "@instaauto/core";
import { prisma } from "@instaauto/db";

let queues: Queues | undefined;

/** BullMQ producers (API only adds jobs; the worker process consumes them). */
export function q(): Queues {
  queues ??= createQueues(createRedis("api-queues"));
  return queues;
}

export async function igClientFor(accountId: string): Promise<IgClient | null> {
  const acc = await prisma.igAccount.findUnique({ where: { id: accountId } });
  if (!acc) return null;
  return clientForAccount(acc, decrypt(acc.accessTokenEnc, env().TOKEN_ENC_KEY), env().IG_API_VERSION);
}

export async function log(accountId: string | null, kind: string, detail?: Record<string, unknown>) {
  await prisma.activityLog.create({ data: { accountId, kind, detail: detail as object | undefined } });
}

/** Never send tokens to the client */
export const publicAccountSelect = {
  id: true,
  igUserId: true,
  username: true,
  accountType: true,
  authType: true,
  profilePictureUrl: true,
  tokenExpiresAt: true,
  paused: true,
  dailyActionLimit: true,
  hourlyActionLimit: true,
  workStartHour: true,
  workEndHour: true,
  timezone: true,
  aiSpamFilter: true,
  replySpeed: true,
  blocklist: true,
  blocklistHide: true,
  webhooksSubscribed: true,
  createdAt: true,
} as const;
