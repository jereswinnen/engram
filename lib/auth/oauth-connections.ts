import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { APIError } from "better-auth"
import { db } from "@/db"
import { authConnections, oauthClient } from "@/db/schema"
import { oauthGrantMatchesClient } from "./oauth-config"

type OAuthUser = { id: string }

type AuthorizationCodeVerification = {
  query: { client_id: string }
  referenceId?: string
  userId: string
}

export async function createPendingOAuthConnection(input: {
  user: OAuthUser
  scopes: readonly string[]
}): Promise<string> {
  const connectionId = randomUUID()
  await db.insert(authConnections).values({
    id: connectionId,
    ownerId: input.user.id,
    mechanism: "oauth",
    provider: "engram",
    providerGrantId: connectionId,
    label: "OAuth connection",
    status: "pending",
    scopes: [...input.scopes],
  })
  return connectionId
}

export async function activateOAuthConnection(input: {
  user?: OAuthUser | null
  scopes: readonly string[]
  verification?: AuthorizationCodeVerification
}): Promise<void> {
  const referenceId = input.verification?.referenceId
  const userId = input.user?.id
  const clientId = input.verification?.query.client_id
  if (!referenceId || !userId || !clientId) return
  if (input.verification?.userId !== userId) {
    throw invalidGrant("OAuth connection owner mismatch")
  }

  const client = await db.query.oauthClient.findFirst({
    where: eq(oauthClient.clientId, clientId),
    columns: { softwareVersion: true, type: true },
  })

  const [connection] = await db
    .update(authConnections)
    .set({
      clientId,
      providerGrantId: referenceId,
      label: connectionLabel(clientId),
      status: "active",
      scopes: [...input.scopes],
      clientVersion: client?.softwareVersion ?? null,
      metadata: client?.type ? { clientType: client.type } : null,
      lastUsedAt: new Date(),
    })
    .where(
      and(
        eq(authConnections.id, referenceId),
        eq(authConnections.ownerId, userId),
        eq(authConnections.status, "pending")
      )
    )
    .returning({ id: authConnections.id })

  if (!connection) throw invalidGrant("OAuth connection is unavailable")
}

export async function requireActiveOAuthConnection(input: {
  user?: OAuthUser | null
  referenceId?: string
  resource?: string
  scopes: readonly string[]
}): Promise<string> {
  if (!input.user?.id || !input.referenceId) {
    throw invalidGrant("OAuth connection identity is missing")
  }

  const connection = await db.query.authConnections.findFirst({
    where: and(
      eq(authConnections.id, input.referenceId),
      eq(authConnections.ownerId, input.user.id),
      eq(authConnections.status, "active")
    ),
    columns: { id: true, clientId: true },
  })
  const appUrl = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL
  if (
    !connection?.clientId ||
    !appUrl ||
    !oauthGrantMatchesClient({
      appUrl,
      clientId: connection.clientId,
      resource: input.resource,
      scopes: input.scopes,
    })
  ) {
    throw invalidGrant("OAuth client is not allowed to use this resource")
  }

  const [touched] = await db
    .update(authConnections)
    .set({ lastUsedAt: new Date() })
    .where(
      and(
        eq(authConnections.id, input.referenceId),
        eq(authConnections.ownerId, input.user.id),
        eq(authConnections.status, "active")
      )
    )
    .returning({ id: authConnections.id })

  if (!touched) throw invalidGrant("OAuth connection was revoked")
  return touched.id
}

function connectionLabel(clientId: string): string {
  if (clientId === "engram-macos") return "Engram for macOS"
  if (clientId === "engram-ios") return "Engram for iOS"
  return `OAuth client ${clientId.slice(0, 12)}`
}

function invalidGrant(description: string) {
  return new APIError("UNAUTHORIZED", {
    error: "invalid_grant",
    error_description: description,
  })
}
