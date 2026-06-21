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
 *
 * NOTE: Uses auth.$context (internal adapter) so it works even with
 * disableSignUp: true — the public sign-up endpoint is intentionally closed.
 */

import { auth } from "../auth";

const email = process.env.SEED_EMAIL;
const password = process.env.SEED_PASSWORD;
const name = process.env.SEED_NAME ?? "Admin";

if (!email || !password) {
  console.error("SEED_EMAIL and SEED_PASSWORD must be set.");
  process.exit(1);
}

const ctx = await auth.$context;

// Idempotency: error clearly if user already exists
const existing = await ctx.internalAdapter.findUserByEmail(email);
if (existing) {
  console.error(`User already exists: ${email}. Remove this script without re-running.`);
  process.exit(1);
}

// Hash the password using Better Auth's own hasher (bcrypt by default)
const hash = await ctx.password.hash(password);

// Create the user row
const user = await ctx.internalAdapter.createUser({
  email,
  name,
  emailVerified: false,
});

if (!user) {
  console.error("Failed to create user.");
  process.exit(1);
}

// Link the credential account (same shape the sign-up route uses)
await ctx.internalAdapter.linkAccount({
  userId: user.id,
  providerId: "credential",
  accountId: user.id,
  password: hash,
});

console.log("User created:", user.email);
console.log("Delete this script before the next commit.");
