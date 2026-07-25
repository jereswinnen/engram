import { beforeEach, describe, expect, it, vi } from "vitest"

const getOwnedRecording = vi.hoisted(() => vi.fn())
const findFirst = vi.hoisted(() => vi.fn())
const findMany = vi.hoisted(() => vi.fn())
const execute = vi.hoisted(() => vi.fn())
const insert = vi.hoisted(() => vi.fn())
const transaction = vi.hoisted(() => vi.fn())
const values = vi.hoisted(() => vi.fn())
const onConflictDoUpdate = vi.hoisted(() => vi.fn())
const embed = vi.hoisted(() => vi.fn())
const embedMany = vi.hoisted(() => vi.fn())

vi.mock("@/lib/recordings/store", () => ({ getOwnedRecording }))
vi.mock("@/db", () => ({
  db: {
    query: {
      transcriptions: { findFirst },
      transcriptEmbeddings: { findMany },
    },
    execute,
    insert,
    transaction,
  },
}))
vi.mock("ai", () => ({ embed, embedMany }))
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => ({ embedding: () => ({ modelId: "embedding-model" }) }),
}))

beforeEach(() => {
  getOwnedRecording.mockReset()
  findFirst.mockReset()
  findMany.mockReset()
  execute.mockReset()
  insert.mockReset()
  transaction.mockReset()
  values.mockReset()
  onConflictDoUpdate.mockReset()
  embed.mockReset()
  embedMany.mockReset()
  process.env.OPENAI_API_KEY = "test-key"
  process.env.OPENAI_EMBEDDING_MODEL = "text-embedding-3-small"

  getOwnedRecording.mockResolvedValue({ id: "recording-a" })
  findFirst.mockResolvedValue({
    id: "transcription-a",
    recordingId: "recording-a",
    fullText: "A roadmap conversation",
    segments: [
      {
        start: 0,
        end: 12,
        text: "A roadmap conversation",
        speaker: "speaker_0",
      },
    ],
  })
  findMany.mockResolvedValue([])
  embedMany.mockResolvedValue({
    embeddings: [[0.1, 0.2]],
    usage: { tokens: 4 },
  })
  onConflictDoUpdate.mockResolvedValue(undefined)
  values.mockReturnValue({ onConflictDoUpdate })
  insert.mockReturnValue({ values })
  transaction.mockImplementation(async (callback) => callback({ insert }))
})

describe("transcript embeddings", () => {
  it("does not call OpenAI or write during a dry run", async () => {
    const { embedLatestTranscript } = await import("./embeddings")
    const result = await embedLatestTranscript("user-a", "recording-a", {
      dryRun: true,
    })

    expect(result.chunks).toBe(1)
    expect(embedMany).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it("generates and idempotently upserts derived embedding rows", async () => {
    const { embedLatestTranscript } = await import("./embeddings")
    const result = await embedLatestTranscript("user-a", "recording-a")

    expect(embedMany).toHaveBeenCalledOnce()
    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({
        ownerId: "user-a",
        recordingId: "recording-a",
        transcriptionId: "transcription-a",
        embeddingModel: "text-embedding-3-small",
        embedding: [0.1, 0.2],
      }),
    ])
    expect(onConflictDoUpdate).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ chunks: 1, tokens: 4, skipped: false })
  })

  it("refuses to embed a recording outside the owner scope", async () => {
    getOwnedRecording.mockResolvedValueOnce(null)
    const { embedLatestTranscript } = await import("./embeddings")

    await expect(
      embedLatestTranscript("user-b", "recording-a")
    ).rejects.toThrow("recording recording-a not found")
    expect(findFirst).not.toHaveBeenCalled()
    expect(embedMany).not.toHaveBeenCalled()
  })
})
