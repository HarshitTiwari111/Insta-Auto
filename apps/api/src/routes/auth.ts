import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@instaauto/db";
import { createSession, destroySession, requireAuth } from "../plugins/auth.js";

const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);
const LoginBody =z.object({ email: z.string().email(), password: z.string().min(1) });

export default async function authRoutes(app: FastifyInstance) {
  app.post(
    "/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = LoginBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_body" });
      const user = await prisma.user.findUnique({ where: { email: body.data.email.toLowerCase() } });
      // Compare even when user is missing to keep timing similar
      const ok = await bcrypt.compare(body.data.password, user?.passwordHash ?? DUMMY_HASH);
      if (!user || !ok) return reply.code(401).send({ error: "invalid_credentials" });
      await createSession(reply, { userId: user.id, email: user.email, role: user.role });
      return { id: user.id, email: user.email, name: user.name, role: user.role };
    },
  );

  app.post("/auth/logout", async (req, reply) => {
    await destroySession(req, reply);
    return { ok: true };
  });

  app.get("/auth/me", { preHandler: requireAuth }, async (req) => {
    const user = await prisma.user.findUnique({
      where: { id: req.session!.userId },
      select: { id: true, email: true, name: true, role: true },
    });
    return user;
  });
}
