import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import type { AuthPrincipal } from "@/lib/auth/principal"
import { oauthUrls } from "@/lib/auth/oauth-config"

export type McpErrorCategory =
  | "insufficient_scope"
  | "invalid_input"
  | "not_found"
  | "stale_cursor"
  | "rate_limited"
  | "response_too_large"
  | "temporarily_unavailable"

export function toolError(
  category: McpErrorCategory,
  message: string
): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: category, message }),
      },
    ],
  }
}

export function requireToolScope(
  principal: AuthPrincipal,
  scope: "transcripts:search" | "transcripts:read",
  appUrl: string
): CallToolResult | null {
  if (principal.scopes.has(scope)) return null
  const metadataUrl = oauthUrls(appUrl).mcpProtectedResourceMetadata
  const challenge = `Bearer resource_metadata="${metadataUrl}", error="insufficient_scope", scope="${scope}"`
  return {
    ...toolError(
      "insufficient_scope",
      "The OAuth grant lacks the required scope."
    ),
    _meta: { "mcp/www_authenticate": challenge },
  }
}
