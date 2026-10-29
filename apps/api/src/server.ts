import { env } from "@instaauto/core";
import { prisma } from "@instaauto/db";
import { buildServer } from "./app.js";

const app = await buildServer();
await app.listen({ port: env().PORT, host: "0.0.0.0" });

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
