import { describe, expect, it } from "vitest"
import { chunkTranscript } from "./chunks"

describe("chunkTranscript", () => {
  it("builds timestamped, overlapping chunks from transcript segments", () => {
    const chunks = chunkTranscript(
      [
        { start: 0, end: 10, text: "Alpha", speaker: "speaker_0" },
        { start: 10, end: 20, text: "Bravo", speaker: "speaker_1" },
        { start: 20, end: 30, text: "Charlie", speaker: "speaker_0" },
      ],
      "",
      { targetCharacters: 60, overlapSegments: 1 }
    )

    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toMatchObject({
      index: 0,
      startSeconds: 0,
      endSeconds: 20,
    })
    expect(chunks[0].content).toContain("[0:00] Speaker 1: Alpha")
    expect(chunks[1].content).toContain("[0:10] Speaker 2: Bravo")
    expect(chunks[0].contentHash).toHaveLength(64)
  })

  it("falls back to plain transcript text when segments are unavailable", () => {
    const chunks = chunkTranscript(
      [],
      "First paragraph.\n\nSecond paragraph.",
      {
        targetCharacters: 20,
      }
    )

    expect(chunks.map((chunk) => chunk.content)).toEqual([
      "First paragraph.",
      "Second paragraph.",
    ])
    expect(chunks[0].startSeconds).toBeNull()
  })

  it("returns no chunks for an empty transcript", () => {
    expect(chunkTranscript([], "   ")).toEqual([])
  })
})
