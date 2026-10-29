/** Working-hours maths for automation. Pure, no I/O. */

/** Local hour + minute in an IANA time zone. */
export function localTime(timeZone: string, d = new Date()): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(d);
  return {
    hour: Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24,
    minute: Number(parts.find((p) => p.type === "minute")?.value ?? 0),
  };
}

/**
 * When automation may run next. null = now is inside working hours (or no hours set).
 * start/end are local hours; end is exclusive; start > end means overnight (e.g. 22 -> 6).
 */
export function nextWorkStart(start: number | null, end: number | null, timeZone: string, now = new Date()): Date | null {
  if (start === null || end === null || start === end) return null;
  const { hour, minute } = localTime(timeZone, now);
  const inside = start < end ? hour >= start && hour < end : hour >= start || hour < end;
  if (inside) return null;
  const hoursUntil = (start - hour + 24) % 24 || 24;
  const ms = hoursUntil * 3600_000 - minute * 60_000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds();
  return new Date(now.getTime() + ms);
}
