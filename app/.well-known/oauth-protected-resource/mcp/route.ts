import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client"
import { auth } from "@/auth"
import {
  oauthEnabled,
  oauthUnavailableResponse,
} from "@/lib/auth/oauth-feature"
import { oauthUrls } from "@/lib/auth/oauth-config"

export async function GET(): Promise<Response> {
  if (!oauthEnabled()) return oauthUnavailableResponse()
  const appUrl = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) return Response.json({ error: "misconfigured" }, { status: 500 })
  const urls = oauthUrls(appUrl)
  const metadata = await oauthProviderResourceClient(auth)
    .getActions()
    .getProtectedResourceMetadata({
      resource: urls.mcpResource,
      authorization_servers: [urls.issuer],
      scopes_supported: ["transcripts:search", "transcripts:read"],
      bearer_methods_supported: ["header"],
    })
  return Response.json(metadata, {
    headers: { "Cache-Control": "public, max-age=300" },
  })
}
