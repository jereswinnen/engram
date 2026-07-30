import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { getOwnedTranscriptDocument } from "@/lib/recordings/documents"
import { nameForLabel } from "@/lib/transcript/speaker-names"
import { recordingUrl } from "@/lib/search/documents"
import { encodeTranscriptCursor } from "@/lib/recordings/documents"
import {
  MCP_MAX_FETCH_SEGMENTS,
  MCP_MAX_TOOL_BYTES,
  utf8ByteLength,
} from "../limits"
import { requireToolScope, toolError } from "../errors"
import {
  oauthSecurityScheme,
  READ_ONLY_ANNOTATIONS,
  textResult,
  timestamp,
  type McpToolContext,
} from "./shared"

export const fetchInputSchema = z.object({ id: z.uuid() }).strict()

export type GetTranscriptDocument = typeof getOwnedTranscriptDocument

export function registerFetchTool(
  server: McpServer,
  context: McpToolContext,
  getDocument: GetTranscriptDocument = getOwnedTranscriptDocument
): void {
  server.registerTool(
    "fetch",
    {
      title: "Fetch Engram transcript",
      description:
        "Retrieve a citable, timestamped source transcript for an Engram recording ID returned by search.",
      inputSchema: fetchInputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: oauthSecurityScheme("transcripts:read"),
    },
    async ({ id }) => {
      const scopeError = requireToolScope(
        context.principal,
        "transcripts:read",
        context.appUrl
      )
      if (scopeError) return scopeError

      try {
        const document = await getDocument(context.principal.userId, id)
        if (!document) {
          return toolError("not_found", "The recording was not found.")
        }

        const allSegments = document.transcription.segments
        let acceptedLines: string[] = []
        let output: Record<string, unknown> | null = null
        const buildOutput = (lines: string[]) => {
          const returnedSegmentCount = lines.length
          const truncated = returnedSegmentCount < allSegments.length
          return {
            id: document.recording.id,
            title: document.recording.title,
            text: lines.join("\n"),
            url: recordingUrl(context.appUrl, document.recording.id),
            metadata: {
              createdAt: document.recording.createdAt.toISOString(),
              durationSeconds: document.recording.durationSeconds,
              language: document.transcription.language,
              segmentCount: allSegments.length,
              returnedSegmentCount,
              truncated,
              nextCursor: truncated
                ? encodeTranscriptCursor({
                    v: 1,
                    transcriptionId: document.transcription.id,
                    offset: returnedSegmentCount,
                  })
                : null,
            },
          }
        }

        for (const segment of allSegments.slice(0, MCP_MAX_FETCH_SEGMENTS)) {
          const speaker = segment.speaker
            ? nameForLabel(segment.speaker, document.speakerMap)
            : "Speaker ?"
          const line = `[${timestamp(segment.start)}–${timestamp(segment.end)}] ${speaker}: ${segment.text}`
          const candidateLines = [...acceptedLines, line]
          const candidate = buildOutput(candidateLines)
          if (utf8ByteLength(JSON.stringify(candidate)) > MCP_MAX_TOOL_BYTES)
            break
          acceptedLines = candidateLines
          output = candidate
        }

        if (allSegments.length === 0) output = buildOutput([])
        if (!output) {
          return toolError(
            "response_too_large",
            "A stored transcript segment exceeds the tool response limit."
          )
        }
        return textResult(output)
      } catch {
        return toolError(
          "temporarily_unavailable",
          "The transcript is temporarily unavailable."
        )
      }
    }
  )
}
