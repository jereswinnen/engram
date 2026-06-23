import { describe, it, expect, vi, beforeEach } from "vitest";

const updates: any[] = [];
let glossaryFails = false;

vi.mock("@/db", () => ({
  db: {
    update: () => ({ set: (v: any) => ({ where: async () => { updates.push(v); } }) }),
    query: {
      recordings: { findFirst: async () => ({ id: "r1", storageKey: "audio/r1.mp3" }) },
      transcriptions: { findFirst: async () => ({ recordingId: "r1", fullText: "hoi", segments: [] }) },
      glossary: { findMany: async () => { if (glossaryFails) throw new Error("DB gone"); return []; } },
    },
    insert: () => ({ values: async () => {} }),
    delete: () => ({ where: async () => {} }),
  },
}));
vi.mock("@/lib/speakers/store", () => ({
  getRecordingSpeakerMap: vi.fn(async () => ({})),
}));
vi.mock("@/lib/storage", () => ({
  getStorage: () => ({ presignedGetUrl: async () => "https://signed" }),
  buildAudioKey: () => "audio/r1.mp3",
}));
vi.mock("@/lib/transcription/scribe", () => ({
  transcribeWithScribe: vi.fn(async () => ({ text: "hoi", language: "nld", segments: [] })),
}));
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
}));
vi.mock("@/lib/config", () => ({
  config: { llmModel: () => "claude-3-haiku" },
}));

beforeEach(() => {
  updates.length = 0;
  glossaryFails = false;
});

describe("runTranscription", () => {
  it("sets transcribing then transcribed", async () => {
    const { runTranscription } = await import("./pipeline");
    await runTranscription("r1");
    expect(updates.map((u) => u.status)).toEqual(["transcribing", "transcribed"]);
  });

  it("sets error when the adapter throws", async () => {
    const scribe = await import("@/lib/transcription/scribe");
    (scribe.transcribeWithScribe as any).mockRejectedValueOnce(new Error("boom"));
    const { runTranscription } = await import("./pipeline");
    await runTranscription("r1");
    expect(updates.at(-1).status).toBe("error");
  });

  it("degrades gracefully when glossary DB fails (still reaches transcribed)", async () => {
    glossaryFails = true;
    const { runTranscription } = await import("./pipeline");
    await runTranscription("r1");
    expect(updates.map((u) => u.status)).toEqual(["transcribing", "transcribed"]);
  });
});

describe("runEnhancement", () => {
  it("sets enhancing then done", async () => {
    const { runEnhancement } = await import("./pipeline");
    await runEnhancement("r1");
    expect(updates.map((u) => u.status)).toEqual(["enhancing", "done"]);
  });

  it("sets error when enhanceTranscript rejects", async () => {
    const enhance = await import("@/lib/ai/enhance");
    (enhance.enhanceTranscript as any).mockRejectedValueOnce(new Error("llm down"));
    const { runEnhancement } = await import("./pipeline");
    await runEnhancement("r1");
    expect(updates.at(-1).status).toBe("error");
  });
});
