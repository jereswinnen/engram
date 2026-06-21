import { describe, it, expect, vi, beforeEach } from "vitest";

const updates: any[] = [];
vi.mock("@/db", () => ({
  db: {
    update: () => ({ set: (v: any) => ({ where: async () => { updates.push(v); } }) }),
    query: { recordings: { findFirst: async () => ({ id: "r1", storageKey: "audio/r1.mp3" }) } },
    insert: () => ({ values: async () => {} }),
  },
}));
vi.mock("@/lib/storage", () => ({
  getStorage: () => ({ presignedGetUrl: async () => "https://signed" }),
  buildAudioKey: () => "audio/r1.mp3",
}));
vi.mock("@/lib/transcription/scribe", () => ({
  transcribeWithScribe: vi.fn(async () => ({ text: "hoi", language: "nld", segments: [] })),
}));

beforeEach(() => { updates.length = 0; });

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
});
