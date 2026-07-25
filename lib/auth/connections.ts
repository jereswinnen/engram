import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { authConnections } from "@/db/schema"
import type { AuthPrincipal } from "./principal"

/**
 * Ensures the temporary legacy grant has a durable server-side identity before
 * a recording references it. OAuth connections are provisioned by the provider
 * flow and are only looked up here; a bearer claim can never create one.
 */
export async function ensureActivePrincipalConnection(
  principal: AuthPrincipal
): Promise<boolean> {
  if (!principal.connectionId) return principal.mechanism === "session"

  if (principal.mechanism === "legacy-mac") {
    await db
      .insert(authConnections)
      .values({
        id: principal.connectionId,
        ownerId: principal.userId,
        mechanism: "legacy-mac",
        provider: "engram",
        clientId: principal.clientId ?? "engram-macos-legacy",
        providerGrantId: principal.grantId ?? principal.connectionId,
        label: "Legacy Mac recorder",
        scopes: [...principal.scopes],
      })
      .onConflictDoNothing({ target: authConnections.id })
  }

  const connection = await db.query.authConnections.findFirst({
    where: and(
      eq(authConnections.id, principal.connectionId),
      eq(authConnections.ownerId, principal.userId)
    ),
    columns: { status: true },
  })

  return connection?.status === "active"
}
