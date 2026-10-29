import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client.js";

export * from "./generated/client.js";

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

function create(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/** One PrismaClient per process (reused across hot reloads in dev). */
export const prisma: PrismaClient = globalForPrisma.__prisma ?? create();
if (process.env.NODE_ENV !== "production") globalForPrisma.__prisma = prisma;
