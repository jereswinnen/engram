import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import {
  encodeTranscriptCursor,
  getOwnedTranscriptPage,
} from "@/lib/recordings/documents"
import { recordingUrl } from "@/lib/search/documents"
import { MCP_MAX_TOOL_BYTES, utf8ByteLength } from "../limits"
import { requireToolScope, toolError } from "../errors"
import {
  oauthSecurityScheme,
  READ_ONLY_ANNOTATIONS,
  type McpToolContext,
} from "./shared"

export const transcriptPageInputSchema = z
  .object({
    recordingId: z.uuid(),
    cursor: z.string().min(1).max(2_048).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict()

const transcriptPageOutputSchema = z.object({
  recording: z.object({
    id: z.string(),
    title: z.string(),
    url: z.string(),
    createdAt: z.string(),
    language: z.string().nullable(),
  }),
  segments: z.array(
    z.object({
      index: z.number().int(),
      startSeconds: z.number(),
      endSeconds: z.number(),
      speaker: z.string().nullable(),
      text: z.string(),
      url: z.string(),
    })
  ),
  nextCursor: z.string().nullable(),
})

export type GetTranscriptPage = typeof getOwnedTranscriptPage

export function registerTranscriptPageTool(
  server: McpServer,
  context: McpToolContext,
  getPage: GetTranscriptPage = getOwnedTranscriptPage
): void {
  server.registerTool(
    "get_transcript_page",
    {
      title: "Continue Engram transcript",
      description:
        "Continue a truncated Engram transcript using its opaque cursor, or retrieve a bounded page of timestamped segments.",
      inputSchema: transcriptPageInputSchema,
      outputSchema: transcriptPageOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: oauthSecurityScheme("transcripts:read"),
    },
    async ({ recordingId, cursor, limit }) => {
      const scopeError = requireToolScope(
        context.principal,
        "transcripts:read",
        context.appUrl
      )
      if (scopeError) return scopeError

      try {
        const result = await getPage(context.principal.userId, recordingId, {
          cursor,
          limit,
        })
        if (!result.ok) {
          if (result.error === "not_found") {
            return toolError("not_found", "The recording was not found.")
          }
          if (result.error === "stale_cursor") {
            return toolError(
              "stale_cursor",
              "The transcript changed; fetch it again to obtain a new cursor."
            )
          }
          return toolError("invalid_input", "The transcript cursor is invalid.")
        }

        const page = result.page
        const accepted: typeof page.segments = []
        let output: z.infer<typeof transcriptPageOutputSchema> | null = null
        const buildOutput = (segments: typeof page.segments) => {
          const nextOffset = page.offset + segments.length
          return {
            recording: {
              id: page.recording.id,
              title: page.recording.title,
              url: recordingUrl(context.appUrl, page.recording.id),
              createdAt: page.recording.createdAt.toISOString(),
              language: page.recording.language,
            },
            segments: segments.map((segment) => ({
              ...segment,
              url: recordingUrl(
                context.appUrl,
                page.recording.id,
                segment.startSeconds
              ),
            })),
            nextCursor:
              nextOffset < page.totalSegmentCount
                ? encodeTranscriptCursor({
                    v: 1,
                    transcriptionId: page.transcriptionId,
                    offset: nextOffset,
                  })
                : null,
          }
        }

        for (const segment of page.segments) {
          const candidateSegments = [...accepted, segment]
          const candidate = buildOutput(candidateSegments)
          if (utf8ByteLength(JSON.stringify(candidate)) > MCP_MAX_TOOL_BYTES) {
            break
          }
          accepted.push(segment)
          output = candidate
        }
        if (page.segments.length === 0) output = buildOutput([])
        if (!output) {
          return toolError(
            "response_too_large",
            "A stored transcript segment exceeds the tool response limit."
          )
        }

        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch {
        return toolError(
          "temporarily_unavailable",
          "The transcript is temporarily unavailable."
        )
      }
    }
  )
}
