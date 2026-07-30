import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { searchEngramDocuments } from "@/lib/search/documents"
import { isWithinToolLimit } from "../limits"
import { requireToolScope, toolError } from "../errors"
import {
  oauthSecurityScheme,
  READ_ONLY_ANNOTATIONS,
  textResult,
  type McpToolContext,
} from "./shared"

export const searchInputSchema = z
  .object({ query: z.string().trim().min(1).max(500) })
  .strict()

export type SearchDocuments = typeof searchEngramDocuments

export function registerSearchTool(
  server: McpServer,
  context: McpToolContext,
  searchDocuments: SearchDocuments = searchEngramDocuments
): void {
  server.registerTool(
    "search",
    {
      title: "Search Engram",
      description:
        "Find the authenticated user's Engram recordings by topic, phrase, person, decision, transcript content, or existing generated notes.",
      inputSchema: searchInputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: oauthSecurityScheme("transcripts:search"),
    },
    async ({ query }) => {
      const scopeError = requireToolScope(
        context.principal,
        "transcripts:search",
        context.appUrl
      )
      if (scopeError) return scopeError

      try {
        const output = await searchDocuments(context.principal.userId, query, {
          appUrl: context.appUrl,
        })
        if (!isWithinToolLimit(output)) {
          return toolError(
            "response_too_large",
            "The bounded search response exceeded the tool limit."
          )
        }
        return textResult(output)
      } catch {
        return toolError(
          "temporarily_unavailable",
          "Engram search is temporarily unavailable."
        )
      }
    }
  )
}
