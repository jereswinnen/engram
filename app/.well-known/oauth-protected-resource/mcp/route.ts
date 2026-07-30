import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client"
import { auth } from "@/auth"
import {
  oauthEnabled,
  oauthUnavailableResponse,
} from "@/lib/auth/oauth-feature"
import { ENGRAM_MCP_SCOPES, oauthUrls } from "@/lib/auth/oauth-config"
import { mcpEnabled, mcpUnavailableResponse } from "@/lib/mcp/feature"

export async function GET(): Promise<Response> {
  if (!mcpEnabled()) return mcpUnavailableResponse()
  if (!oauthEnabled()) return oauthUnavailableResponse()
  const appUrl = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) return Response.json({ error: "misconfigured" }, { status: 500 })
  const urls = oauthUrls(appUrl)
  const metadata = await oauthProviderResourceClient(auth)
    .getActions()
    .getProtectedResourceMetadata({
      resource: urls.mcpResource,
      authorization_servers: [urls.issuer],
      scopes_supported: [...ENGRAM_MCP_SCOPES],
      bearer_methods_supported: ["header"],
    })
  return Response.json(metadata, {
    headers: { "Cache-Control": "public, max-age=300" },
  })
}
