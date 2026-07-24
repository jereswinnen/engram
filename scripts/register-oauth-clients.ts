import { randomUUID } from "node:crypto"
import { pathToFileURL } from "node:url"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { oauthClient } from "@/db/schema"
import {
  ENGRAM_MAC_CLIENT_ID,
  ENGRAM_MAC_REDIRECT_URI,
  ENGRAM_MAC_SCOPES,
} from "@/lib/auth/oauth-config"

export const MAC_CLIENT_REGISTRATION = {
  clientId: ENGRAM_MAC_CLIENT_ID,
  name: "Engram for macOS",
  redirectUris: [ENGRAM_MAC_REDIRECT_URI] as string[],
  tokenEndpointAuthMethod: "none",
  grantTypes: ["authorization_code", "refresh_token"] as string[],
  responseTypes: ["code"] as string[],
  public: true,
  type: "native",
  requirePKCE: true,
  skipConsent: true,
  scopes: [...ENGRAM_MAC_SCOPES] as string[],
}

export async function provisionOAuthClients(): Promise<"created" | "updated"> {
  return db.transaction(async (tx) => {
    const existing = await tx.query.oauthClient.findFirst({
      where: eq(oauthClient.clientId, ENGRAM_MAC_CLIENT_ID),
    })
    if (existing?.clientSecret) {
      throw new Error(
        "engram-macos exists as a confidential client; refusing to replace it"
      )
    }

    if (!existing) {
      await tx.insert(oauthClient).values({
        id: randomUUID(),
        ...MAC_CLIENT_REGISTRATION,
        disabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      return "created"
    }

    await tx
      .update(oauthClient)
      .set({
        ...MAC_CLIENT_REGISTRATION,
        disabled: false,
        updatedAt: new Date(),
      })
      .where(eq(oauthClient.id, existing.id))
    return "updated"
  })
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const result = await provisionOAuthClients()
  console.info(`${ENGRAM_MAC_CLIENT_ID}: ${result}`)
}
