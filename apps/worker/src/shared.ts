import {
  cached,
  clientForAccount,
  consume,
  createQueues,
  createRedis,
  decrypt,
  env,
  type FlowLike,
  type FlowStep,
  type IgClient,
  keys,
  markOnce,
  nextWorkStart,
  redis,
  utcDay,
  type Queues,
} from "@instaauto/core";
import { prisma, type AutomationRule, type IgAccount } from "@instaauto/db";

let queues: Queues | undefined;
export function q(): Queues {
  queues ??= createQueues(createRedis("worker-queues"));
  return queues;
}

export function igFor(acc: IgAccount): IgClient {
  return clientForAccount(acc, decrypt(acc.accessTokenEnc, env().TOKEN_ENC_KEY), env().IG_API_VERSION);
}

/** Rules are read on every event: cache 5 min, API invalidates on every change. */
export function rulesFor(accountId: string, trigger: "COMMENT" | "DM"): Promise<AutomationRule[]> {
  return cached(redis(), keys.rules(accountId, trigger), 300, () =>
    prisma.automationRule.findMany({ where: { accountId, trigger, enabled: true } }),
  );
}

const utcHour = (d = new Date()) => d.toISOString().slice(0, 13);

/** Enabled DM flows: cached 5 min, API invalidates on every change. */
export function flowsFor(accountId: string): Promise<FlowLike[]> {
  return cached(redis(), keys.flows(accountId), 300, async () =>
    (await prisma.dmFlow.findMany({ where: { accountId, enabled: true }, orderBy: { createdAt: "asc" } })).map((f) => ({
      id: f.id,
      enabled: f.enabled,
      keywords: f.keywords,
      steps: f.steps as unknown as FlowStep[],
    })),
  );
}

/** Daily action budget per account (UTC day). Returns false when exhausted. Also counts the hourly budget. */
export async function takeDailyAction(acc: IgAccount): Promise<boolean> {
  const r = await consume(redis(), keys.dailyActions(acc.id, utcDay()), acc.dailyActionLimit, 2 * 24 * 3600);
  if (r.allowed) await consume(redis(), keys.hourlyActions(acc.id, utcHour()), Number.MAX_SAFE_INTEGER, 2 * 3600);
  return r.allowed;
}

/** Thrown to park an event until automation may run again (working hours / hourly limit). */
export class DeferError extends Error {
  constructor(
    readonly until: Date,
    readonly reason: string,
  ) {
    super(`deferred until ${until.toISOString()}: ${reason}`);
  }
}

/** Speed control: the first time an event is seen, park it for a random human-like pause. */
export async function humanPause(acc: IgAccount, eventKey: string): Promise<void> {
  const range = acc.replySpeed === "slow" ? [60, 180] : acc.replySpeed === "medium" ? [20, 60] : null;
  if (!range) return;
  if (!(await markOnce(redis(), `${keys.dedupe(`speed:${eventKey}`)}`, 24 * 3600))) return; // already waited
  const [min, max] = range as [number, number];
  throw new DeferError(new Date(Date.now() + (min + Math.random() * (max - min)) * 1000), `reply speed ${acc.replySpeed}`);
}

/** Throws DeferError when the account is outside working hours or over its hourly budget. */
export async function gateAutomation(acc: IgAccount): Promise<void> {
  const start = nextWorkStart(acc.workStartHour, acc.workEndHour, acc.timezone);
  if (start) throw new DeferError(start, "outside working hours");
  const used = Number((await redis().get(keys.hourlyActions(acc.id, utcHour()))) ?? 0);
  if (used >= acc.hourlyActionLimit) {
    const next = new Date();
    next.setUTCMinutes(60, 5, 0); // a few seconds into the next UTC hour
    throw new DeferError(next, "hourly limit reached");
  }
}

export async function log(accountId: string | null, kind: string, detail?: Record<string, unknown>) {
  await prisma.activityLog.create({ data: { accountId, kind, detail: detail as object | undefined } });
}

export async function notify(title: string, body: string, url = "/") {
  await q().notify.add("notify", { title, body, url });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
