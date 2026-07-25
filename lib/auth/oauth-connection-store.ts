import { and, desc, eq, isNull } from "drizzle-orm"
import { db } from "@/db"
import {
  authConnections,
  oauthAccessToken,
  oauthConsent,
  oauthRefreshToken,
} from "@/db/schema"

export async function listOAuthConnections(ownerId: string) {
  return db.query.authConnections.findMany({
    where: and(
      eq(authConnections.ownerId, ownerId),
      eq(authConnections.mechanism, "oauth")
    ),
    orderBy: [desc(authConnections.createdAt)],
  })
}

export async function revokeOAuthConnection(
  ownerId: string,
  connectionId: string
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [connection] = await tx
      .update(authConnections)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(
        and(
          eq(authConnections.id, connectionId),
          eq(authConnections.ownerId, ownerId),
          eq(authConnections.mechanism, "oauth"),
          eq(authConnections.status, "active")
        )
      )
      .returning({ id: authConnections.id })
    if (!connection) return false

    await tx
      .update(oauthRefreshToken)
      .set({ revoked: new Date() })
      .where(
        and(
          eq(oauthRefreshToken.userId, ownerId),
          eq(oauthRefreshToken.referenceId, connectionId),
          isNull(oauthRefreshToken.revoked)
        )
      )
    await tx
      .delete(oauthAccessToken)
      .where(
        and(
          eq(oauthAccessToken.userId, ownerId),
          eq(oauthAccessToken.referenceId, connectionId)
        )
      )
    await tx
      .delete(oauthConsent)
      .where(
        and(
          eq(oauthConsent.userId, ownerId),
          eq(oauthConsent.referenceId, connectionId)
        )
      )
    return true
  })
}
