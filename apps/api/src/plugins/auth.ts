import { randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { env, keys, redis } from "@instaauto/core";

export const SESSION_COOKIE = "ia_sid";

export interface Session {
  userId: string;
  email: string;
  role: "ADMIN" | "MEMBER";
}

declare module "fastify" {
  interface FastifyRequest {
    session?: Session;
  }
}

const ttlSec = () => env().SESSION_TTL_DAYS * 24 * 3600;

/** Sessions live in Redis: instant logout/revoke, no DB hit per request. */
export async function createSession(reply: FastifyReply, s: Session): Promise<void> {
  const sid = randomBytes(32).toString("base64url");
  await redis().set(keys.session(sid), JSON.stringify(s), "EX", ttlSec());
  reply.setCookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: env().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ttlSec(),
  });
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sid = req.cookies[SESSION_COOKIE];
  if (sid) await redis().del(keys.session(sid));
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

/** preHandler: loads session (sliding expiry) or replies 401. */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sid = req.cookies[SESSION_COOKIE];
  if (!sid) return void reply.code(401).send({ error: "unauthorized" });
  const k = keys.session(sid);
  const raw = await redis().get(k);
  if (!raw) return void reply.code(401).send({ error: "unauthorized" });
  await redis().expire(k, ttlSec());
  req.session = JSON.parse(raw) as Session;
}
