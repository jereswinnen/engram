import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { getOwnedSummary } from "@/lib/recordings/documents"
import { recordingUrl } from "@/lib/search/documents"
import { isWithinToolLimit } from "../limits"
import { toolError } from "../errors"
import {
  oauthSecurityScheme,
  READ_ONLY_ANNOTATIONS,
  runMcpTool,
  type McpToolContext,
} from "./shared"

export const summaryInputSchema = z.object({ recordingId: z.uuid() }).strict()

const summaryOutputSchema = z.object({
  recording: z.object({
    id: z.string(),
    title: z.string(),
    url: z.string(),
    createdAt: z.string(),
  }),
  overview: z.string(),
  keyPoints: z.array(z.string()),
  decisions: z.array(z.string()),
  actionItems: z.array(
    z.object({
      text: z.string(),
      owner: z.string().nullable(),
      due: z.string().nullable(),
    })
  ),
  chapters: z.array(
    z.object({
      title: z.string(),
      gist: z.string(),
      startSeconds: z.number().nullable(),
      url: z.string().nullable(),
    })
  ),
  openQuestions: z.array(z.string()),
})

export type GetSummary = typeof getOwnedSummary

export function registerSummaryTool(
  server: McpServer,
  context: McpToolContext,
  getSummary: GetSummary = getOwnedSummary
): void {
  server.registerTool(
    "get_summary",
    {
      title: "Get Engram meeting notes",
      description:
        "Retrieve Engram's existing overview, key points, decisions, actions, chapters, and open questions for a recording without generating new content.",
      inputSchema: summaryInputSchema,
      outputSchema: summaryOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: oauthSecurityScheme("transcripts:read"),
    },
    async ({ recordingId }) =>
      runMcpTool(
        context,
        { tool: "get_summary", scope: "transcripts:read", timeoutMs: 5_000 },
        async () => {
          try {
            const summary = await getSummary(
              context.principal.userId,
              recordingId
            )
            if (!summary) {
              return toolError("not_found", "The recording was not found.")
            }
            const output = {
              recording: {
                id: summary.recording.id,
                title: summary.recording.title,
                url: recordingUrl(context.appUrl, summary.recording.id),
                createdAt: summary.recording.createdAt.toISOString(),
              },
              overview: summary.overview,
              keyPoints: summary.keyPoints,
              decisions: summary.decisions,
              actionItems: summary.actionItems,
              chapters: summary.chapters.map((chapter) => ({
                ...chapter,
                url:
                  chapter.startSeconds === null
                    ? null
                    : recordingUrl(
                        context.appUrl,
                        summary.recording.id,
                        chapter.startSeconds
                      ),
              })),
              openQuestions: summary.openQuestions,
            }
            if (!isWithinToolLimit(output)) {
              return toolError(
                "response_too_large",
                "The stored meeting notes exceed the tool response limit."
              )
            }

            return {
              content: [{ type: "text", text: JSON.stringify(output) }],
              structuredContent: output,
            }
          } catch {
            return toolError(
              "temporarily_unavailable",
              "The meeting notes are temporarily unavailable."
            )
          }
        }
      )
  )
}
