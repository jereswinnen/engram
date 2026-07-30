import { describe, it, expect, vi, beforeEach } from "vitest"

const updates: Record<string, unknown>[] = []
const inserts: Record<string, unknown>[] = []
let glossaryFails = false

vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: async () => {
          updates.push(v)
        },
      }),
    }),
    query: {
      recordings: {
        findFirst: async () => ({ id: "r1", storageKey: "audio/r1.mp3" }),
      },
      transcriptions: {
        findFirst: async () => ({
          recordingId: "r1",
          fullText: "hoi",
          segments: [],
        }),
      },
      glossary: {
        findMany: async () => {
          if (glossaryFails) throw new Error("DB gone")
          return []
        },
      },
    },
    insert: () => ({
      values: async (value: Record<string, unknown>) => {
        inserts.push(value)
      },
    }),
    delete: () => ({ where: async () => {} }),
  },
}))
vi.mock("@/lib/speakers/store", () => ({
  getRecordingSpeakerMap: vi.fn(async () => ({})),
}))
vi.mock("@/lib/storage", () => ({
  getStorage: () => ({ presignedGetUrl: async () => "https://signed" }),
  buildAudioKey: () => "audio/r1.mp3",
}))
vi.mock("@/lib/transcription/scribe", () => ({
  transcribeWithScribe: vi.fn(async () => ({
    text: "hoi",
    language: "nld",
    segments: [],
  })),
}))
vi.mock("@/lib/ai/enhance", () => ({
  enhanceTranscript: vi.fn(async () => ({
    title: "T",
    overview: "O",
    keyPoints: [],
    decisions: [],
    actionItems: [],
    chapters: [],
    openQuestions: [],
  })),
}))
vi.mock("@/lib/config", () => ({
  config: { llmModel: () => "claude-3-haiku" },
}))

beforeEach(() => {
  updates.length = 0
  inserts.length = 0
  glossaryFails = false
})

describe("runTranscription", () => {
  it("sets transcribing then transcribed", async () => {
    const { runTranscription } = await import("./pipeline")
    const succeeded = await runTranscription("user-a", "r1")
    expect(succeeded).toBe(true)
    expect(updates.map((u) => u.status)).toEqual([
      "transcribing",
      "transcribed",
    ])
  })

  it("sets error when the adapter throws", async () => {
    const scribe = await import("@/lib/transcription/scribe")
    vi.mocked(scribe.transcribeWithScribe).mockRejectedValueOnce(
      new Error("boom")
    )
    const { runTranscription } = await import("./pipeline")
    const succeeded = await runTranscription("user-a", "r1")
    expect(succeeded).toBe(false)
    expect(updates.at(-1)?.status).toBe("error")
  })

  it("degrades gracefully when glossary DB fails (still reaches transcribed)", async () => {
    glossaryFails = true
    const { runTranscription } = await import("./pipeline")
    const succeeded = await runTranscription("user-a", "r1")
    expect(succeeded).toBe(true)
    expect(updates.map((u) => u.status)).toEqual([
      "transcribing",
      "transcribed",
    ])
  })
})

describe("runEnhancement", () => {
  it("sets enhancing then done", async () => {
    const { runEnhancement } = await import("./pipeline")
    await runEnhancement("user-a", "r1")
    expect(updates.map((u) => u.status)).toEqual(["enhancing", "done"])
    expect(inserts.at(-1)?.searchText).toBe("O")
  })

  it("sets error when enhanceTranscript rejects", async () => {
    const enhance = await import("@/lib/ai/enhance")
    vi.mocked(enhance.enhanceTranscript).mockRejectedValueOnce(
      new Error("llm down")
    )
    const { runEnhancement } = await import("./pipeline")
    await runEnhancement("user-a", "r1")
    expect(updates.at(-1)?.status).toBe("error")
  })
})
