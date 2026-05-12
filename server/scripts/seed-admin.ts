// Seed first admin user. Usage:
//   ADMIN_USERNAME=admin ADMIN_PASSWORD=secret npx tsx scripts/seed-admin.ts
import "dotenv/config";
import { db } from "../lib/db.js";
import { createUser, getUserByUsername } from "../lib/auth.js";

const username = process.env.ADMIN_USERNAME || "admin";
const password = process.env.ADMIN_PASSWORD;

if (!password) {
  console.error("ADMIN_PASSWORD env required");
  process.exit(1);
}

const existing = getUserByUsername(username);
if (existing) {
  if (existing.role !== "admin") {
    db.prepare(`UPDATE users SET role = 'admin', status = 'active' WHERE id = ?`).run(existing.id);
    console.log(`Promoted '${username}' to admin.`);
  } else {
    console.log(`Admin '${username}' already exists.`);
  }
} else {
  const user = createUser({
    username,
    password,
    role: "admin",
    initialBalance: 1_000_000,
  });
  console.log(`Created admin '${user.username}' (id=${user.id}) with balance 1,000,000.`);
}
