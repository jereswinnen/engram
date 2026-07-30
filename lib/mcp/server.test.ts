import { describe, expect, it, vi } from "vitest"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import type { AuthPrincipal } from "@/lib/auth/principal"

vi.mock("@/lib/search/documents", () => ({
  searchEngramDocuments: vi.fn(),
  recordingUrl: (appUrl: string, id: string, start: number | null = null) =>
    `${appUrl}/recordings/${id}${start === null ? "" : `?t=${start}`}`,
}))
vi.mock("@/lib/recordings/documents", () => ({
  getOwnedTranscriptDocument: vi.fn(),
  getOwnedTranscriptPage: vi.fn(),
  getOwnedSummary: vi.fn(),
  encodeTranscriptCursor: vi.fn(() => "cursor"),
}))
vi.mock("@/db", () => ({ db: { execute: vi.fn() } }))

import { createEngramMcpServer, type McpServerDependencies } from "./server"

const PRINCIPAL: AuthPrincipal = {
  userId: "user-a",
  mechanism: "oauth",
  audience: "https://engram.example/mcp",
  clientId: "codex",
  scopes: new Set(["transcripts:search", "transcripts:read"]),
}

async function request(
  method: string,
  params?: Record<string, unknown>,
  dependencies: McpServerDependencies = {},
  principal: AuthPrincipal = PRINCIPAL
) {
  const server = createEngramMcpServer(
    { principal, appUrl: "https://engram.example" },
    {
      rateLimit: async () => ({
        allowed: true,
        limit: 60,
        remaining: 59,
        retryAfterSeconds: 60,
      }),
      logEvent: () => undefined,
      ...dependencies,
    }
  )
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  try {
    const response = await transport.handleRequest(
      new Request("https://engram.example/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "mcp-protocol-version": "2025-03-26",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          ...(params ? { params } : {}),
        }),
      })
    )
    return await response.json()
  } finally {
    await server.close()
  }
}

describe("Engram MCP server", () => {
  const recordingId = "20000000-0000-4000-8000-000000000001"
  const transcriptionId = "10000000-0000-4000-8000-000000000001"

  it("initializes with short operational instructions", async () => {
    const response = await request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test-host", version: "1.0.0" },
    })

    expect(response.result.serverInfo).toEqual({
      name: "engram",
      version: "1.0.0",
    })
    expect(response.result.instructions).toContain("Search before fetching")
  })

  it("lists exactly four read-only, closed-world tools with OAuth metadata", async () => {
    const response = await request("tools/list")
    const tools = response.result.tools

    expect(tools.map((tool: { name: string }) => tool.name)).toEqual([
      "search",
      "fetch",
      "get_transcript_page",
      "get_summary",
    ])
    for (const tool of tools) {
      expect(tool.title).toBeTruthy()
      expect(tool.description).toBeTruthy()
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      })
      expect(tool._meta.securitySchemes).toEqual([
        expect.objectContaining({ type: "oauth2" }),
      ])
      expect(tool.inputSchema.additionalProperties).toBe(false)
    }
  })

  it("passes only the authenticated owner identity into search", async () => {
    const searchDocuments = vi.fn(async () => ({ results: [] }))
    const response = await request(
      "tools/call",
      { name: "search", arguments: { query: "roadmap" } },
      { searchDocuments }
    )

    expect(response.result.isError).not.toBe(true)
    expect(searchDocuments).toHaveBeenCalledWith("user-a", "roadmap", {
      appUrl: "https://engram.example",
    })
    expect(JSON.parse(response.result.content[0].text)).toEqual({ results: [] })
  })

  it("returns a tool-level scope challenge without calling the service", async () => {
    const searchDocuments = vi.fn()
    const response = await request(
      "tools/call",
      { name: "search", arguments: { query: "roadmap" } },
      { searchDocuments },
      { ...PRINCIPAL, scopes: new Set(["transcripts:read"]) }
    )

    expect(response.result.isError).toBe(true)
    expect(response.result._meta["mcp/www_authenticate"]).toContain(
      'scope="transcripts:search"'
    )
    expect(searchDocuments).not.toHaveBeenCalled()
  })

  it("fetches a bounded timestamped source document for its owner", async () => {
    const getTranscriptDocument = vi.fn(async () => ({
      recording: {
        id: recordingId,
        title: "Roadmap",
        createdAt: new Date("2026-07-01T10:00:00Z"),
        durationSeconds: 90,
      },
      transcription: {
        id: transcriptionId,
        language: "en",
        segments: [
          {
            start: 12.4,
            end: 18.05,
            speaker: "speaker_0",
            text: "Ship Friday",
          },
        ],
      },
      speakerMap: { speaker_0: "Jeremy" },
    }))
    const response = await request(
      "tools/call",
      { name: "fetch", arguments: { id: recordingId } },
      { getTranscriptDocument: getTranscriptDocument as never }
    )
    const output = JSON.parse(response.result.content[0].text)

    expect(getTranscriptDocument).toHaveBeenCalledWith("user-a", recordingId)
    expect(output).toMatchObject({
      id: recordingId,
      text: "[00:12.400–00:18.050] Jeremy: Ship Friday",
      metadata: {
        segmentCount: 1,
        returnedSegmentCount: 1,
        truncated: false,
        nextCursor: null,
      },
    })
  })

  it("returns structured transcript pages with segment deep links", async () => {
    const getTranscriptPage = vi.fn(async () => ({
      ok: true as const,
      page: {
        transcriptionId,
        offset: 0,
        totalSegmentCount: 1,
        recording: {
          id: recordingId,
          title: "Roadmap",
          createdAt: new Date("2026-07-01T10:00:00Z"),
          durationSeconds: 90,
          language: "en",
        },
        segments: [
          {
            index: 0,
            startSeconds: 12.4,
            endSeconds: 18.05,
            speaker: "Jeremy",
            text: "Ship Friday",
          },
        ],
        nextCursor: null,
      },
    }))
    const response = await request(
      "tools/call",
      {
        name: "get_transcript_page",
        arguments: { recordingId, limit: 50 },
      },
      { getTranscriptPage: getTranscriptPage as never }
    )

    expect(getTranscriptPage).toHaveBeenCalledWith("user-a", recordingId, {
      cursor: undefined,
      limit: 50,
    })
    expect(response.result.structuredContent.segments[0].url).toBe(
      `https://engram.example/recordings/${recordingId}?t=12.4`
    )
  })

  it("returns existing generated notes with chapter deep links", async () => {
    const getSummary = vi.fn(async () => ({
      recording: {
        id: recordingId,
        title: "Roadmap",
        createdAt: new Date("2026-07-01T10:00:00Z"),
      },
      overview: "Launch planning",
      keyPoints: ["Verify"],
      decisions: ["Ship Friday"],
      actionItems: [{ text: "Prepare", owner: "Sam", due: null }],
      chapters: [{ title: "Release", gist: "Plan", startSeconds: 12.4 }],
      openQuestions: ["Who verifies?"],
    }))
    const response = await request(
      "tools/call",
      { name: "get_summary", arguments: { recordingId } },
      { getSummary: getSummary as never }
    )

    expect(getSummary).toHaveBeenCalledWith("user-a", recordingId)
    expect(response.result.structuredContent).toMatchObject({
      overview: "Launch planning",
      chapters: [
        {
          url: `https://engram.example/recordings/${recordingId}?t=12.4`,
        },
      ],
    })
  })

  it("rejects oversized single transcript segments without slicing text", async () => {
    const getTranscriptDocument = vi.fn(async () => ({
      recording: {
        id: recordingId,
        title: "Large",
        createdAt: new Date("2026-07-01T10:00:00Z"),
        durationSeconds: null,
      },
      transcription: {
        id: transcriptionId,
        language: null,
        segments: [{ start: 0, end: 1, text: "x".repeat(50_000) }],
      },
      speakerMap: {},
    }))
    const response = await request(
      "tools/call",
      { name: "fetch", arguments: { id: recordingId } },
      { getTranscriptDocument: getTranscriptDocument as never }
    )

    expect(response.result.isError).toBe(true)
    expect(JSON.parse(response.result.content[0].text).error).toBe(
      "response_too_large"
    )
  })

  it("rejects additional input fields before calling a tool", async () => {
    const searchDocuments = vi.fn()
    const response = await request(
      "tools/call",
      {
        name: "search",
        arguments: { query: "roadmap", includeAudio: true },
      },
      { searchDocuments }
    )

    expect(response.result.isError).toBe(true)
    expect(response.result.content[0].text).toContain("Invalid arguments")
    expect(searchDocuments).not.toHaveBeenCalled()
  })
})
