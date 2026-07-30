import { describe, expect, it, vi } from "vitest"

vi.mock("./search", () => ({ searchRecordings: vi.fn() }))
vi.mock("./enhancements", () => ({ searchGeneratedNotes: vi.fn() }))

import { searchEngramDocuments } from "./documents"

const transcriptPage = {
  results: [
    {
      passageId: "p1",
      recordingId: "r1",
      title: "Launch",
      createdAt: new Date("2026-07-01T10:00:00Z"),
      snippet: "Discuss &lt;risk&gt; and <mark>verification</mark>",
      matchType: "hybrid" as const,
      startSeconds: 12,
      endSeconds: 18,
      score: 0.03,
      similarity: 0.8,
    },
  ],
  pagination: { limit: 12, offset: 0, hasMore: false },
}

describe("searchEngramDocuments", () => {
  it("fuses transcript and generated-note matches with explicit provenance", async () => {
    const searchTranscripts = vi.fn(async () => transcriptPage)
    const searchNotes = vi.fn(async () => [
      {
        evidenceId: "e1:decision:1",
        recordingId: "r1",
        title: "Launch",
        createdAt: new Date("2026-07-01T10:00:00Z"),
        snippet: "The decision was to verify Friday",
        source: "decision" as const,
        startSeconds: null,
        score: 0.4,
      },
      {
        evidenceId: "e2:chapter:1",
        recordingId: "r2",
        title: "Operations",
        createdAt: new Date("2026-07-02T10:00:00Z"),
        snippet: "Verification plan",
        source: "chapter" as const,
        startSeconds: 30,
        score: 0.3,
      },
    ])

    const output = await searchEngramDocuments(
      "user-a",
      " verification ",
      { appUrl: "https://engram.example" },
      { searchTranscripts, searchNotes }
    )

    expect(searchTranscripts).toHaveBeenCalledWith("user-a", "verification", {
      limit: 12,
      offset: 0,
    })
    expect(searchNotes).toHaveBeenCalledWith("user-a", "verification", {
      limit: 12,
    })
    expect(output.results[0]).toMatchObject({
      id: "r1",
      url: "https://engram.example/recordings/r1?t=12",
      snippets: [
        {
          text: "Discuss <risk> and verification",
          source: "transcript",
          generated: false,
          startSeconds: 12,
          endSeconds: 18,
        },
        {
          source: "decision",
          generated: true,
          startSeconds: null,
        },
      ],
    })
    expect(output.results[1].url).toBe(
      "https://engram.example/recordings/r2?t=30"
    )
  })

  it("caps documents and evidence even when dependencies over-return", async () => {
    const results = Array.from({ length: 12 }, (_, index) => ({
      ...transcriptPage.results[0],
      passageId: `p${index}`,
      recordingId: `r${Math.floor(index / 4)}`,
      title: `Recording ${Math.floor(index / 4)}`,
    }))
    const output = await searchEngramDocuments(
      "user-a",
      "query",
      {
        appUrl: "https://engram.example",
        resultLimit: 99,
        snippetsPerRecording: 99,
      },
      {
        searchTranscripts: async () => ({
          results,
          pagination: { limit: 12, offset: 0, hasMore: false },
        }),
        searchNotes: async () => [],
      }
    )

    expect(output.results.length).toBeLessThanOrEqual(8)
    expect(output.results.every((result) => result.snippets.length <= 3)).toBe(
      true
    )
  })

  it("does no provider or database work for blank queries", async () => {
    const searchTranscripts = vi.fn()
    const searchNotes = vi.fn()
    expect(
      await searchEngramDocuments(
        "user-a",
        "   ",
        { appUrl: "https://engram.example" },
        { searchTranscripts, searchNotes }
      )
    ).toEqual({ results: [] })
    expect(searchTranscripts).not.toHaveBeenCalled()
    expect(searchNotes).not.toHaveBeenCalled()
  })
})
