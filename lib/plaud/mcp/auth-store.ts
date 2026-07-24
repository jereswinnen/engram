import { createHash, randomBytes } from "node:crypto"
import { and, eq, gt, isNull } from "drizzle-orm"
import type {
  OAuthClientInformation,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js"
import { db } from "@/db"
import { apiCredentials, plaudOAuthAttempts } from "@/db/schema"
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets"
import { ownerPredicate } from "@/lib/auth/ownership"
import { config } from "@/lib/config"

const PROVIDER = "plaud"
const ATTEMPT_TTL_MS = 10 * 60 * 1000

interface PlaudCredentialState {
  tokens?: OAuthTokens
  clientInformation?: OAuthClientInformation
}

async function credentialRow(ownerId: string) {
  return db.query.apiCredentials.findFirst({
    where: and(
      eq(apiCredentials.provider, PROVIDER),
      ownerPredicate(apiCredentials.ownerId, ownerId)
    ),
  })
}

async function loadCredential(ownerId: string): Promise<PlaudCredentialState> {
  const row = await credentialRow(ownerId)
  if (!row) return {}
  try {
    return JSON.parse(decryptSecret(row.ciphertext)) as PlaudCredentialState
  } catch {
    return {}
  }
}

async function saveCredential(
  ownerId: string,
  state: PlaudCredentialState
): Promise<void> {
  const ciphertext = encryptSecret(JSON.stringify(state))
  const existing = await credentialRow(ownerId)
  if (existing) {
    await db
      .update(apiCredentials)
      .set({ ownerId, ciphertext })
      .where(eq(apiCredentials.id, existing.id))
    return
  }

  await db.insert(apiCredentials).values({
    ownerId,
    provider: PROVIDER,
    ciphertext,
  })
}

const hashState = (state: string) =>
  createHash("sha256").update(state).digest("hex")

async function loadAttempt(ownerId: string, attemptId: string) {
  return db.query.plaudOAuthAttempts.findFirst({
    where: and(
      eq(plaudOAuthAttempts.id, attemptId),
      eq(plaudOAuthAttempts.ownerId, ownerId)
    ),
  })
}

export async function createPlaudOAuthAttempt(ownerId: string) {
  const state = randomBytes(32).toString("base64url")
  const [attempt] = await db
    .insert(plaudOAuthAttempts)
    .values({
      ownerId,
      stateHash: hashState(state),
      encryptedVerifier: encryptSecret(""),
      redirectUri: config.plaudRedirectUrl(),
      expiresAt: new Date(Date.now() + ATTEMPT_TTL_MS),
    })
    .returning({ id: plaudOAuthAttempts.id })
  return { attemptId: attempt.id, state }
}

export async function consumePlaudOAuthAttempt(ownerId: string, state: string) {
  const [attempt] = await db
    .update(plaudOAuthAttempts)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(plaudOAuthAttempts.ownerId, ownerId),
        eq(plaudOAuthAttempts.stateHash, hashState(state)),
        isNull(plaudOAuthAttempts.usedAt),
        gt(plaudOAuthAttempts.expiresAt, new Date())
      )
    )
    .returning({ id: plaudOAuthAttempts.id })
  return attempt ?? null
}

export function createPlaudAuthStore(ownerId: string, attemptId?: string) {
  const requireAttempt = async () => {
    if (!attemptId) throw new Error("Missing Plaud OAuth attempt")
    const attempt = await loadAttempt(ownerId, attemptId)
    if (!attempt) throw new Error("Plaud OAuth attempt not found")
    return attempt
  }

  return {
    async getTokens() {
      return (await loadCredential(ownerId)).tokens
    },
    async saveTokens(tokens: OAuthTokens) {
      const state = await loadCredential(ownerId)
      state.tokens = tokens
      await saveCredential(ownerId, state)
    },
    async getClientInfo() {
      return (await loadCredential(ownerId)).clientInformation
    },
    async saveClientInfo(info: OAuthClientInformation) {
      const state = await loadCredential(ownerId)
      state.clientInformation = info
      await saveCredential(ownerId, state)
    },
    async getCodeVerifier() {
      const attempt = await requireAttempt()
      const verifier = decryptSecret(attempt.encryptedVerifier)
      return verifier || undefined
    },
    async saveCodeVerifier(verifier: string) {
      await requireAttempt()
      await db
        .update(plaudOAuthAttempts)
        .set({ encryptedVerifier: encryptSecret(verifier) })
        .where(
          and(
            eq(plaudOAuthAttempts.id, attemptId!),
            eq(plaudOAuthAttempts.ownerId, ownerId)
          )
        )
    },
    async getAuthorizationUrl() {
      const attempt = await requireAttempt()
      return attempt.encryptedAuthorizationUrl
        ? decryptSecret(attempt.encryptedAuthorizationUrl)
        : undefined
    },
    async saveAuthorizationUrl(url: string) {
      await requireAttempt()
      await db
        .update(plaudOAuthAttempts)
        .set({ encryptedAuthorizationUrl: encryptSecret(url) })
        .where(
          and(
            eq(plaudOAuthAttempts.id, attemptId!),
            eq(plaudOAuthAttempts.ownerId, ownerId)
          )
        )
    },
    async isConnected() {
      return Boolean((await loadCredential(ownerId)).tokens)
    },
    async clear() {
      await db
        .delete(apiCredentials)
        .where(
          and(
            eq(apiCredentials.provider, PROVIDER),
            ownerPredicate(apiCredentials.ownerId, ownerId)
          )
        )
    },
  }
}
