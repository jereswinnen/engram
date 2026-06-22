import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apiCredentials } from "@/db/schema";
import { encryptSecret, decryptSecret } from "@/lib/crypto/secrets";
import type { OAuthClientInformation, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

const PROVIDER = "plaud";

interface PlaudOAuthState {
  tokens?: OAuthTokens;
  clientInformation?: OAuthClientInformation;
  codeVerifier?: string;
  authorizationUrl?: string;
}

async function load(): Promise<PlaudOAuthState> {
  const row = await db.query.apiCredentials.findFirst({ where: eq(apiCredentials.provider, PROVIDER) });
  return row ? (JSON.parse(decryptSecret(row.ciphertext)) as PlaudOAuthState) : {};
}

async function save(state: PlaudOAuthState): Promise<void> {
  const ciphertext = encryptSecret(JSON.stringify(state));
  await db
    .insert(apiCredentials)
    .values({ provider: PROVIDER, ciphertext })
    .onConflictDoUpdate({ target: apiCredentials.provider, set: { ciphertext } });
}

export const plaudAuthStore = {
  async getTokens() { return (await load()).tokens; },
  async saveTokens(tokens: OAuthTokens) { const s = await load(); s.tokens = tokens; await save(s); },
  async getClientInfo() { return (await load()).clientInformation; },
  async saveClientInfo(info: OAuthClientInformation) { const s = await load(); s.clientInformation = info; await save(s); },
  async getCodeVerifier() { return (await load()).codeVerifier; },
  async saveCodeVerifier(v: string) { const s = await load(); s.codeVerifier = v; await save(s); },
  async getAuthorizationUrl() { return (await load()).authorizationUrl; },
  async saveAuthorizationUrl(url: string) { const s = await load(); s.authorizationUrl = url; await save(s); },
  async isConnected() { return Boolean((await load()).tokens); },
  async clear() { await db.delete(apiCredentials).where(eq(apiCredentials.provider, PROVIDER)); },
};
