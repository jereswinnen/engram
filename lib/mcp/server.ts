import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { AuthPrincipal } from "@/lib/auth/principal"
import { registerSearchTool, type SearchDocuments } from "./tools/search"
import { registerFetchTool, type GetTranscriptDocument } from "./tools/fetch"
import {
  registerTranscriptPageTool,
  type GetTranscriptPage,
} from "./tools/get-transcript-page"
import { registerSummaryTool, type GetSummary } from "./tools/get-summary"

const SERVER_INSTRUCTIONS =
  "Engram contains the authenticated user's private meeting transcripts and existing meeting notes. Search before fetching unless a recording ID is already known. Use get_transcript_page only to continue a truncated fetch. Every tool is read-only; Engram cannot expose audio or mutate recordings."

export type McpServerDependencies = {
  searchDocuments?: SearchDocuments
  getTranscriptDocument?: GetTranscriptDocument
  getTranscriptPage?: GetTranscriptPage
  getSummary?: GetSummary
}

export function createEngramMcpServer(
  context: { principal: AuthPrincipal; appUrl: string },
  dependencies: McpServerDependencies = {}
): McpServer {
  const server = new McpServer(
    { name: "engram", version: "1.0.0" },
    { instructions: SERVER_INSTRUCTIONS }
  )
  registerSearchTool(server, context, dependencies.searchDocuments)
  registerFetchTool(server, context, dependencies.getTranscriptDocument)
  registerTranscriptPageTool(server, context, dependencies.getTranscriptPage)
  registerSummaryTool(server, context, dependencies.getSummary)
  return server
}
