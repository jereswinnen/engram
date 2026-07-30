import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import type { AuthPrincipal } from "@/lib/auth/principal"

export type McpToolContext = {
  principal: AuthPrincipal
  appUrl: string
}

export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const

export function oauthSecurityScheme(scope: string) {
  return {
    securitySchemes: [{ type: "oauth2", scopes: [scope] }],
  }
}

export function textResult(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
  }
}

export function timestamp(value: number): string {
  const totalMilliseconds = Math.round(Math.max(0, value) * 1000)
  const hours = Math.floor(totalMilliseconds / 3_600_000)
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000)
  const seconds = Math.floor((totalMilliseconds % 60_000) / 1000)
  const milliseconds = totalMilliseconds % 1000
  const hourPrefix = hours > 0 ? `${hours.toString().padStart(2, "0")}:` : ""
  return `${hourPrefix}${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}.${milliseconds.toString().padStart(3, "0")}`
}
