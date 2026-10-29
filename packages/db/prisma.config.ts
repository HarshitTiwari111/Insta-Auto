import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Single .env at the repo root
config({ path: "../../.env" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Fallback only so `prisma generate` works without a DB (e.g. during npm install)
    url: process.env["DATABASE_URL"] ?? "postgresql://localhost:5432/placeholder",
  },
});
