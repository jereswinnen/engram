import { createHash } from "node:crypto"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { utf8ByteLength } from "./limits"
import type { McpErrorCategory } from "./errors"
import type { McpToolName } from "./rate-limit"

export type McpToolEvent = {
  event: "mcp_tool_call"
  requestId: string
  tool: McpToolName
  durationMs: number
  outcome: "success" | "error"
  resultCount: number
  resultBytes: number
  userHash: string
  clientHash: string
  connectionHash: string
  rateLimit: "allowed" | "denied" | "unavailable"
  errorCategory?: McpErrorCategory
}

function identityHash(value: string | undefined): string {
  return createHash("sha256")
    .update(value ?? "unknown")
    .digest("hex")
    .slice(0, 16)
}

function resultSummary(result: CallToolResult): {
  resultCount: number
  errorCategory?: McpErrorCategory
} {
  let value: unknown
  if (result.structuredContent) {
    value = result.structuredContent
  } else {
    const text = result.content.find((item) => item.type === "text")?.text
    if (text) {
      try {
        value = JSON.parse(text)
      } catch {
        value = undefined
      }
    }
  }
  if (!value || typeof value !== "object") return { resultCount: 0 }
  const record = value as Record<string, unknown>
  const collection = Array.isArray(record.results)
    ? record.results
    : Array.isArray(record.segments)
      ? record.segments
      : null
  return {
    resultCount:
      collection?.length ?? ("id" in record || "recording" in record ? 1 : 0),
    errorCategory:
      typeof record.error === "string"
        ? (record.error as McpErrorCategory)
        : undefined,
  }
}

export function buildMcpToolEvent(input: {
  requestId: string
  tool: McpToolName
  startedAt: number
  finishedAt: number
  result: CallToolResult
  userId: string
  clientId?: string
  connectionId?: string
  rateLimit: McpToolEvent["rateLimit"]
}): McpToolEvent {
  const summary = resultSummary(input.result)
  return {
    event: "mcp_tool_call",
    requestId: input.requestId,
    tool: input.tool,
    durationMs: Math.max(0, Math.round(input.finishedAt - input.startedAt)),
    outcome: input.result.isError ? "error" : "success",
    resultCount: summary.resultCount,
    resultBytes: utf8ByteLength(JSON.stringify(input.result)),
    userHash: identityHash(input.userId),
    clientHash: identityHash(input.clientId),
    connectionHash: identityHash(input.connectionId),
    rateLimit: input.rateLimit,
    ...(summary.errorCategory ? { errorCategory: summary.errorCategory } : {}),
  }
}

export function logMcpToolEvent(event: McpToolEvent): void {
  console.info(JSON.stringify(event))
}
