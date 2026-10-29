/**
 * Create or update a team login.
 * Usage: npm run create-user -- <email> <password> [name] [admin]
 */
import bcrypt from "bcryptjs";
import { prisma } from "@instaauto/db";

const [email, password, name, admin] = process.argv.slice(2);
if (!email || !password || password.length < 10) {
  console.error("Usage: npm run create-user -- <email> <password(min 10 chars)> [name] [admin]");
  process.exit(1);
}

const passwordHash = await bcrypt.hash(password, 12);
const role = admin === "admin" ? "ADMIN" : "MEMBER";
const user = await prisma.user.upsert({
  where: { email: email.toLowerCase() },
  create: { email: email.toLowerCase(), passwordHash, name: name ?? null, role },
  update: { passwordHash, name: name ?? undefined, role },
});
console.log(`OK: ${user.email} (${user.role})`);
await prisma.$disconnect();
