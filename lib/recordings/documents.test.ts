import { describe, expect, it, vi } from "vitest"

vi.mock("./store", () => ({ getOwnedRecordingBundle: vi.fn() }))
vi.mock("@/lib/speakers/store", () => ({
  getRecordingSpeakerMap: vi.fn(),
}))

import {
  decodeTranscriptCursor,
  encodeTranscriptCursor,
  getOwnedSummary,
  getOwnedTranscriptDocument,
  getOwnedTranscriptPage,
} from "./documents"

const TRANSCRIPTION_ID = "10000000-0000-4000-8000-000000000001"

function bundle(overrides: Record<string, unknown> = {}) {
  return {
    recording: {
      id: "20000000-0000-4000-8000-000000000001",
      title: "Roadmap",
      createdAt: new Date("2026-07-01T10:00:00Z"),
      durationSeconds: 90,
    },
    transcription: {
      id: TRANSCRIPTION_ID,
      language: "en",
      segments: [
        { start: 0, end: 4, speaker: "speaker_0", text: "Opening" },
        { start: 4, end: 9, speaker: "speaker_1", text: "Decision" },
        { start: 9, end: 14, text: "Closing" },
      ],
    },
    enhancement: {
      overview: "A roadmap meeting",
      keyPoints: ["Ship carefully"],
      decisions: ["Release Friday"],
      actionItems: [{ text: "Prepare release", owner: "Sam" }],
      chapters: [{ title: "Plan", gist: "Release plan", startSeconds: 4 }],
      openQuestions: ["Who verifies?"],
    },
    ...overrides,
  } as never
}

describe("transcript cursor", () => {
  it("round-trips a versioned latest-transcription cursor", () => {
    const cursor = { v: 1 as const, transcriptionId: TRANSCRIPTION_ID, offset: 5 }
    expect(decodeTranscriptCursor(encodeTranscriptCursor(cursor))).toEqual(
      cursor
    )
  })

  it("rejects malformed, out-of-range, and extended cursor envelopes", () => {
    expect(decodeTranscriptCursor("not-json")).toBeNull()
    expect(
      decodeTranscriptCursor(
        Buffer.from(
          JSON.stringify({
            v: 1,
            transcriptionId: TRANSCRIPTION_ID,
            offset: -1,
          })
        ).toString("base64url")
      )
    ).toBeNull()
    expect(
      decodeTranscriptCursor(
        Buffer.from(
          JSON.stringify({
            v: 1,
            transcriptionId: TRANSCRIPTION_ID,
            offset: 0,
            ownerId: "other-user",
          })
        ).toString("base64url")
      )
    ).toBeNull()
  })
})

describe("owner-scoped recording documents", () => {
  it("loads the bundle with owner identity and resolves speaker names", async () => {
    const getBundle = vi.fn(async () => bundle())
    const getSpeakerMap = vi.fn(async () => ({ speaker_0: "Jeremy" }))

    const document = await getOwnedTranscriptDocument("user-a", "recording-a", {
      getBundle,
      getSpeakerMap,
    })

    expect(getBundle).toHaveBeenCalledWith("user-a", "recording-a")
    expect(getSpeakerMap).toHaveBeenCalledWith("user-a", "recording-a")
    expect(document?.speakerMap).toEqual({ speaker_0: "Jeremy" })
  })

  it("returns the same not-found result for missing and inaccessible rows", async () => {
    const result = await getOwnedTranscriptPage("user-a", "recording-b", {}, {
      getBundle: async () => null,
      getSpeakerMap: async () => {
        throw new Error("must not be called")
      },
    })
    expect(result).toEqual({ ok: false, error: "not_found" })
  })

  it("paginates, resolves known labels, and formats unknown labels", async () => {
    const dependencies = {
      getBundle: async () => bundle(),
      getSpeakerMap: async () => ({ speaker_0: "Jeremy" }),
    }
    const first = await getOwnedTranscriptPage(
      "user-a",
      "recording-a",
      { limit: 1 },
      dependencies
    )
    expect(first.ok && first.page.segments[0]).toMatchObject({
      index: 0,
      speaker: "Jeremy",
      text: "Opening",
    })
    expect(first.ok && first.page.nextCursor).toBeTruthy()

    const second = await getOwnedTranscriptPage(
      "user-a",
      "recording-a",
      { cursor: first.ok ? first.page.nextCursor! : undefined, limit: 1 },
      dependencies
    )
    expect(second.ok && second.page.segments[0]).toMatchObject({
      index: 1,
      speaker: "Speaker 2",
    })
  })

  it("detects a cursor issued for an older transcription", async () => {
    const cursor = encodeTranscriptCursor({
      v: 1,
      transcriptionId: "30000000-0000-4000-8000-000000000001",
      offset: 1,
    })
    const result = await getOwnedTranscriptPage(
      "user-a",
      "recording-a",
      { cursor },
      {
        getBundle: async () => bundle(),
        getSpeakerMap: async () => ({}),
      }
    )
    expect(result).toEqual({ ok: false, error: "stale_cursor" })
  })

  it("returns existing generated notes without invoking a model", async () => {
    const getBundle = vi.fn(async () => bundle())
    const summary = await getOwnedSummary("user-a", "recording-a", {
      getBundle,
    })

    expect(summary).toMatchObject({
      overview: "A roadmap meeting",
      actionItems: [{ text: "Prepare release", owner: "Sam", due: null }],
      chapters: [{ title: "Plan", gist: "Release plan", startSeconds: 4 }],
    })
    expect(getBundle).toHaveBeenCalledWith("user-a", "recording-a")
  })
})
