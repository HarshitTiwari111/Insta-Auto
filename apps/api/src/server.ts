import bcrypt from "bcryptjs";
import { env, logger } from "@instaauto/core";
import { prisma } from "@instaauto/db";
import { buildServer } from "./app.js";

/** Hosts without a shell (free plans): create the first admin from env when there are no users yet. */
async function bootstrapAdmin() {
  const { BOOTSTRAP_ADMIN_EMAIL: email, BOOTSTRAP_ADMIN_PASSWORD: password } = env();
  if (!email || !password) return;
  if ((await prisma.user.count()) > 0) return;
  if (password.length < 10) return logger.warn("BOOTSTRAP_ADMIN_PASSWORD must be at least 10 characters");
  await prisma.user.create({
    data: { email: email.toLowerCase(), passwordHash: await bcrypt.hash(password, 12), name: "Admin", role: "ADMIN" },
  });
  logger.info({ email }, "bootstrap admin created");
}

await bootstrapAdmin();
const app = await buildServer();
await app.listen({ port: env().PORT, host: "0.0.0.0" });

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
