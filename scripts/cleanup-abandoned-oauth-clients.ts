import { and, eq, isNull, lt, ne, notExists } from "drizzle-orm"
import { db } from "@/db"
import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
} from "@/db/schema"
import { ENGRAM_MAC_CLIENT_ID } from "@/lib/auth/oauth-config"

const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
const removed = await db
  .delete(oauthClient)
  .where(
    and(
      isNull(oauthClient.userId),
      ne(oauthClient.clientId, ENGRAM_MAC_CLIENT_ID),
      lt(oauthClient.createdAt, cutoff),
      notExists(
        db
          .select({ id: oauthConsent.id })
          .from(oauthConsent)
          .where(eq(oauthConsent.clientId, oauthClient.clientId))
      ),
      notExists(
        db
          .select({ id: oauthRefreshToken.id })
          .from(oauthRefreshToken)
          .where(eq(oauthRefreshToken.clientId, oauthClient.clientId))
      ),
      notExists(
        db
          .select({ id: oauthAccessToken.id })
          .from(oauthAccessToken)
          .where(eq(oauthAccessToken.clientId, oauthClient.clientId))
      )
    )
  )
  .returning({ id: oauthClient.id })

console.info(`Removed ${removed.length} abandoned OAuth client(s)`)
