import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { randomUUID } from "node:crypto"
import type { AuthPrincipal } from "@/lib/auth/principal"
import { registerSearchTool, type SearchDocuments } from "./tools/search"
import { registerFetchTool, type GetTranscriptDocument } from "./tools/fetch"
import {
  registerTranscriptPageTool,
  type GetTranscriptPage,
} from "./tools/get-transcript-page"
import { registerSummaryTool, type GetSummary } from "./tools/get-summary"
import {
  DEFAULT_MCP_EVENT_LOGGER,
  DEFAULT_MCP_RATE_LIMITER,
  type McpRateLimiter,
} from "./tools/shared"
import type { McpToolEvent } from "./observability"

const SERVER_INSTRUCTIONS =
  "Engram contains the authenticated user's private meeting transcripts and existing meeting notes. Search before fetching unless a recording ID is already known. Use get_transcript_page only to continue a truncated fetch. Every tool is read-only; Engram cannot expose audio or mutate recordings."

export type McpServerDependencies = {
  searchDocuments?: SearchDocuments
  getTranscriptDocument?: GetTranscriptDocument
  getTranscriptPage?: GetTranscriptPage
  getSummary?: GetSummary
  rateLimit?: McpRateLimiter
  logEvent?: (event: McpToolEvent) => void
}

export function createEngramMcpServer(
  context: { principal: AuthPrincipal; appUrl: string; requestId?: string },
  dependencies: McpServerDependencies = {}
): McpServer {
  const server = new McpServer(
    { name: "engram", version: "1.0.0" },
    { instructions: SERVER_INSTRUCTIONS }
  )
  const toolContext = {
    ...context,
    requestId: context.requestId ?? randomUUID(),
    rateLimit: dependencies.rateLimit ?? DEFAULT_MCP_RATE_LIMITER,
    logEvent: dependencies.logEvent ?? DEFAULT_MCP_EVENT_LOGGER,
  }
  registerSearchTool(server, toolContext, dependencies.searchDocuments)
  registerFetchTool(server, toolContext, dependencies.getTranscriptDocument)
  registerTranscriptPageTool(
    server,
    toolContext,
    dependencies.getTranscriptPage
  )
  registerSummaryTool(server, toolContext, dependencies.getSummary)
  return server
}
