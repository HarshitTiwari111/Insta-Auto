import type { Redis } from "ioredis";
import { randomUUID } from "node:crypto";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Read-through cache with stampede protection ("single flight"):
 * on a miss only one caller computes the value, others wait briefly for it.
 */
export async function cached<T>(
  r: Redis,
  key: string,
  ttlSec: number,
  compute: () => Promise<T>,
): Promise<T> {
  const hit = await r.get(key);
  if (hit !== null) return JSON.parse(hit) as T;

  const lockKey = `${key}:fill`;
  const gotLock = await r.set(lockKey, "1", "PX", 10_000, "NX");
  if (!gotLock) {
    // Someone else is computing. Wait up to ~2s for their result, then compute ourselves.
    for (let i = 0; i < 20; i++) {
      await sleep(100);
      const v = await r.get(key);
      if (v !== null) return JSON.parse(v) as T;
    }
    return compute();
  }
  try {
    const value = await compute();
    await r.set(key, JSON.stringify(value), "EX", ttlSec);
    return value;
  } finally {
    await r.del(lockKey);
  }
}

export async function invalidate(r: Redis, ...keys: string[]): Promise<void> {
  if (keys.length) await r.del(...keys);
}

// ---------- Rate limiting (fixed window, atomic via Lua) ----------

const FIXED_WINDOW = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
return {c, ttl}
`;

export interface LimitResult {
  allowed: boolean;
  count: number;
  /** seconds until the window resets */
  resetIn: number;
}

/** Consume 1 unit from a fixed window counter. */
export async function consume(r: Redis, key: string, limit: number, windowSec: number): Promise<LimitResult> {
  const [count, ttl] = (await r.eval(FIXED_WINDOW, 1, key, String(windowSec))) as [number, number];
  return { allowed: count <= limit, count, resetIn: Math.max(ttl, 0) };
}

// ---------- Distributed lock ----------

const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

/** Returns a release() function, or null if the lock is held by someone else. */
export async function acquireLock(r: Redis, key: string, ttlMs: number): Promise<(() => Promise<void>) | null> {
  const token = randomUUID();
  const ok = await r.set(key, token, "PX", ttlMs, "NX");
  if (!ok) return null;
  return async () => {
    await r.eval(RELEASE, 1, key, token);
  };
}

/** SET NX with TTL. true = first time we've seen this key. */
export async function markOnce(r: Redis, key: string, ttlSec: number): Promise<boolean> {
  return (await r.set(key, "1", "EX", ttlSec, "NX")) === "OK";
}
