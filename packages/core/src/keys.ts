/**
 * Every Redis key in one place, so TTLs and naming stay consistent.
 * Prefix "ia:" keeps them separate from BullMQ's own "bull:" keys.
 */
const P = "ia";

export const keys = {
  session: (sid: string) => `${P}:sess:${sid}`,
  oauthState: (state: string) => `${P}:oauth:${state}`,

  /** Webhook / polling dedupe (Meta retries deliveries for up to 36h) */
  dedupe: (key: string) => `${P}:dedupe:${key}`,
  /** One private reply per comment (Meta rule) */
  privateReplyDone: (commentId: string) => `${P}:pr:done:${commentId}`,

  /** Cache */
  rules: (accountId: string, trigger: string) => `${P}:cache:rules:${accountId}:${trigger}`,
  flows: (accountId: string) => `${P}:cache:flows:${accountId}`,
  /** Where a person is in a DM flow (24h, like Meta's messaging window) */
  flowState: (accountId: string, igsid: string) => `${P}:flow:${accountId}:${igsid}`,
  media: (accountId: string) => `${P}:cache:media:${accountId}`,
  profile: (accountId: string) => `${P}:cache:profile:${accountId}`,

  /** Counters / limits */
  dailyActions: (accountId: string, day: string) => `${P}:limit:day:${accountId}:${day}`,
  /** hour = UTC "YYYY-MM-DDTHH" */
  hourlyActions: (accountId: string, hour: string) => `${P}:limit:hour:${accountId}:${hour}`,
  rlPrivateReplies: (accountId: string) => `${P}:rl:pr:${accountId}`,
  rlSend: (accountId: string) => `${P}:rl:send:${accountId}`,
  ruleCooldown: (accountId: string, igsid: string, ruleId: string) => `${P}:cool:${accountId}:${igsid}:${ruleId}`,

  /** 24h messaging window: set when the user messages us */
  dmWindow: (accountId: string, igsid: string) => `${P}:win:${accountId}:${igsid}`,

  /** Comment polling cursor (ISO time of newest comment already seen) */
  pollSince: (accountId: string) => `${P}:poll:since:${accountId}`,

  lock: (name: string) => `${P}:lock:${name}`,
};

export function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}
