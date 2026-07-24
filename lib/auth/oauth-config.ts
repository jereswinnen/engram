const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "")

export const ENGRAM_MAC_CLIENT_ID = "engram-macos"
export const ENGRAM_IOS_CLIENT_ID = "engram-ios"
export const ENGRAM_MAC_REDIRECT_URI =
  "jeremys.engram.recorder://oauth/callback"

export const ENGRAM_OAUTH_SCOPES = [
  "recordings:write",
  "recordings:delete-own",
  "recordings:read",
  "transcripts:search",
  "transcripts:read",
  "offline_access",
] as const

export const ENGRAM_MAC_SCOPES = [
  "recordings:write",
  "recordings:delete-own",
  "offline_access",
] as const

export const ENGRAM_MCP_SCOPES = [
  "transcripts:search",
  "transcripts:read",
  "offline_access",
] as const

export type EngramOAuthScope = (typeof ENGRAM_OAUTH_SCOPES)[number]

export function oauthUrls(appUrl: string) {
  const base = trimTrailingSlash(appUrl)

  return {
    app: base,
    issuer: `${base}/api/auth`,
    apiResource: `${base}/api`,
    mcpResource: `${base}/mcp`,
    authorizationServerMetadata: `${base}/.well-known/oauth-authorization-server/api/auth`,
    openIdConfiguration: `${base}/api/auth/.well-known/openid-configuration`,
    apiProtectedResourceMetadata: `${base}/.well-known/oauth-protected-resource/api`,
    mcpProtectedResourceMetadata: `${base}/.well-known/oauth-protected-resource/mcp`,
  } as const
}
