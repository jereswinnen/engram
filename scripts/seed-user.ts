/**
 * One-off user seed script — run ONCE after first deploy, then REMOVE.
 *
 * Required env vars:
 *   DATABASE_URL        Neon/Postgres connection string
 *   BETTER_AUTH_URL     App base URL (e.g. https://engram.up.railway.app)
 *   BETTER_AUTH_SECRET  32-char secret (same as production)
 *   SEED_EMAIL          E-mail address for the single admin user
 *   SEED_PASSWORD       Password for the single admin user (min 8 chars)
 *
 * Usage (Railway one-off command or local with correct env):
 *   pnpm dlx tsx scripts/seed-user.ts
 *
 * After running: delete this file and commit the removal.
 */

import { auth } from "../auth";

const email = process.env.SEED_EMAIL;
const password = process.env.SEED_PASSWORD;
const name = process.env.SEED_NAME ?? "Admin";

if (!email || !password) {
  console.error("SEED_EMAIL and SEED_PASSWORD must be set.");
  process.exit(1);
}

try {
  const result = await auth.api.signUpEmail({
    body: { email, password, name },
  });
  console.log("User created:", result.user.email);
  console.log("Delete this script before the next commit.");
} catch (err) {
  console.error("Seed failed:", err);
  process.exit(1);
}
