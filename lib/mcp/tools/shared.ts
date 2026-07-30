import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import type { AuthPrincipal } from "@/lib/auth/principal"
import { requireToolScope, toolError } from "../errors"
import {
  buildMcpToolEvent,
  logMcpToolEvent,
  type McpToolEvent,
} from "../observability"
import {
  checkMcpRateLimit,
  type McpToolName,
  type RateLimitResult,
} from "../rate-limit"

export type McpRateLimiter = (input: {
  userId: string
  clientId?: string
  tool: McpToolName
}) => Promise<RateLimitResult>

export type McpToolContext = {
  principal: AuthPrincipal
  appUrl: string
  requestId: string
  rateLimit: McpRateLimiter
  logEvent: (event: McpToolEvent) => void
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

export async function runMcpTool(
  context: McpToolContext,
  policy: {
    tool: McpToolName
    scope: "transcripts:search" | "transcripts:read"
    timeoutMs: number
  },
  operation: () => Promise<CallToolResult>
): Promise<CallToolResult> {
  const startedAt = performance.now()
  let rateLimitOutcome: McpToolEvent["rateLimit"] = "unavailable"
  let result: CallToolResult

  try {
    const scopeError = requireToolScope(
      context.principal,
      policy.scope,
      context.appUrl
    )
    if (scopeError) {
      result = scopeError
    } else {
      const rate = await context.rateLimit({
        userId: context.principal.userId,
        clientId: context.principal.clientId,
        tool: policy.tool,
      })
      rateLimitOutcome = rate.allowed ? "allowed" : "denied"
      if (!rate.allowed) {
        result = toolError(
          "rate_limited",
          `Try again in ${rate.retryAfterSeconds} seconds.`
        )
      } else {
        let timeout: ReturnType<typeof setTimeout> | undefined
        try {
          result = await Promise.race([
            operation(),
            new Promise<CallToolResult>((resolve) => {
              timeout = setTimeout(
                () =>
                  resolve(
                    toolError(
                      "temporarily_unavailable",
                      "The Engram operation timed out."
                    )
                  ),
                policy.timeoutMs
              )
            }),
          ])
        } finally {
          if (timeout) clearTimeout(timeout)
        }
      }
    }
  } catch {
    result = toolError(
      "temporarily_unavailable",
      "Engram is temporarily unavailable."
    )
  }

  try {
    context.logEvent(
      buildMcpToolEvent({
        requestId: context.requestId,
        tool: policy.tool,
        startedAt,
        finishedAt: performance.now(),
        result,
        userId: context.principal.userId,
        clientId: context.principal.clientId,
        connectionId: context.principal.connectionId,
        rateLimit: rateLimitOutcome,
      })
    )
  } catch {
    // Observability must never change a tool result.
  }
  return result
}

export const DEFAULT_MCP_RATE_LIMITER: McpRateLimiter = (input) =>
  checkMcpRateLimit(input, { cleanup: Math.random() < 0.01 })

export const DEFAULT_MCP_EVENT_LOGGER = logMcpToolEvent

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
