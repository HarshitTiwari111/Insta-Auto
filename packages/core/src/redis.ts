import { Redis } from "ioredis";
import { env } from "./env.js";

/**
 * maxRetriesPerRequest: null is required by BullMQ for blocking connections,
 * and is fine for cache usage too (commands wait while reconnecting).
 */
export function createRedis(name: string): Redis {
  return new Redis(env().REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    connectionName: `instaauto:${name}`,
  });
}

let shared: Redis | undefined;

/** Shared client for cache / rate-limit / sessions / locks (non-blocking commands only). */
export function redis(): Redis {
  shared ??= createRedis("shared");
  return shared;
}
