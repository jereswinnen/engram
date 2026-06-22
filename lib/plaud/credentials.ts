import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apiCredentials } from "@/db/schema";
import { encryptSecret, decryptSecret } from "@/lib/crypto/secrets";

const PROVIDER = "plaud";

export async function savePlaudToken(token: string): Promise<void> {
  const ciphertext = encryptSecret(token.trim());
  await db
    .insert(apiCredentials)
    .values({ provider: PROVIDER, ciphertext })
    .onConflictDoUpdate({ target: apiCredentials.provider, set: { ciphertext } });
}

export async function getPlaudToken(): Promise<string | null> {
  const row = await db.query.apiCredentials.findFirst({ where: eq(apiCredentials.provider, PROVIDER) });
  return row ? decryptSecret(row.ciphertext) : null;
}

export async function hasPlaudToken(): Promise<boolean> {
  const row = await db.query.apiCredentials.findFirst({ where: eq(apiCredentials.provider, PROVIDER) });
  return Boolean(row);
}
