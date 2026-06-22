import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PlaudRecording } from "./types";

function rec(p: Partial<PlaudRecording> & { fileId: string; startAtMs: number }): PlaudRecording {
  return { name: p.fileId, startAt: new Date(p.startAtMs).toISOString(), trashed: false, ...p };
}

describe("selectNewRecordings", () => {
  it("keeps untrashed, newer-than-checkpoint, not-already-present, sorted ascending", async () => {
    const { selectNewRecordings } = await import("./sync");
    const all = [
      rec({ fileId: "old", startAtMs: 100 }),
      rec({ fileId: "dup", startAtMs: 300 }),
      rec({ fileId: "trash", startAtMs: 400, trashed: true }),
      rec({ fileId: "b", startAtMs: 500 }),
      rec({ fileId: "a", startAtMs: 250 }),
    ];
    const out = selectNewRecordings(all, 200, new Set(["dup"]));
    expect(out.map((r) => r.fileId)).toEqual(["a", "b"]);
  });
});

// Orchestration: mock all IO collaborators.
const calls: any = { stored: [], inserted: [], transcribed: [], enhanced: [], syncStateSet: [] };
vi.mock("./client", () => ({
  PlaudAuthError: class PlaudAuthError extends Error {},
  listRecordings: vi.fn(),
  getRecordingDetail: vi.fn(async (_t: string, id: string) => ({
    fileId: id, name: id, startAt: "x", startAtMs: 0, trashed: false, audioUrl: `https://signed/${id}`,
  })),
  downloadAudio: vi.fn(async () => ({ bytes: Buffer.from("x"), contentType: "audio/mpeg" })),
}));
vi.mock("./credentials", () => ({ getPlaudToken: vi.fn(async () => "token") }));
vi.mock("@/lib/storage", () => ({
  getStorage: () => ({ put: vi.fn(async (k: string) => { calls.stored.push(k); }) }),
  buildAudioKey: (id: string, f: string) => `audio/${id}.${f.split(".").pop()}`,
}));
vi.mock("@/lib/pipeline", () => ({
  runTranscription: vi.fn(async (id: string) => { calls.transcribed.push(id); }),
  runEnhancement: vi.fn(async (id: string) => { calls.enhanced.push(id); }),
}));
vi.mock("@/db", () => ({
  db: {
    insert: () => ({ values: () => ({ returning: async () => { const id = `rec-${calls.inserted.length}`; calls.inserted.push(id); return [{ id }]; } }) }),
    update: () => ({ set: (v: any) => ({ where: async () => { calls.syncStateSet.push(v); } }) }),
    query: {
      recordings: { findMany: async () => calls.existing ?? [], findFirst: async () => ({ status: "transcribed" }) },
      syncState: { findFirst: async () => calls.syncRow ?? { id: "s1", lastSyncedAt: null, lastResult: null } },
    },
  },
}));

beforeEach(() => {
  calls.stored = []; calls.inserted = []; calls.transcribed = []; calls.enhanced = [];
  calls.syncStateSet = []; calls.existing = []; calls.syncRow = { id: "s1", lastSyncedAt: null, lastResult: null };
});

describe("syncPlaud", () => {
  it("ingests new recordings through the pipeline and advances the checkpoint", async () => {
    const client = await import("./client");
    (client.listRecordings as any).mockResolvedValueOnce([
      { fileId: "f1", name: "One", startAt: "x", startAtMs: 1000, trashed: false },
      { fileId: "f2", name: "Two", startAt: "x", startAtMs: 2000, trashed: false },
    ]);
    const { syncPlaud } = await import("./sync");
    const result = await syncPlaud();
    expect(result.newCount).toBe(2);
    expect(result.failedCount).toBe(0);
    expect(calls.transcribed).toHaveLength(2);
    expect(calls.enhanced).toHaveLength(2);
    // checkpoint advanced to max startAt (2000) and lastResult written
    const lastSet = calls.syncStateSet.at(-1);
    expect(new Date(lastSet.lastSyncedAt).getTime()).toBe(2000);
    expect(lastSet.lastResult.newCount).toBe(2);
  });

  it("skips trashed + already-present and counts skips", async () => {
    calls.existing = [{ plaudFileId: "f1" }];
    const client = await import("./client");
    (client.listRecordings as any).mockResolvedValueOnce([
      { fileId: "f1", name: "dup", startAt: "x", startAtMs: 1000, trashed: false },
      { fileId: "f2", name: "trash", startAt: "x", startAtMs: 2000, trashed: true },
      { fileId: "f3", name: "new", startAt: "x", startAtMs: 3000, trashed: false },
    ]);
    const { syncPlaud } = await import("./sync");
    const result = await syncPlaud();
    expect(result.newCount).toBe(1);
    expect(result.skippedCount).toBe(2);
    expect(calls.transcribed).toEqual(["rec-0"]);
  });

  it("on PlaudAuthError records reconnect-needed and does NOT advance the checkpoint", async () => {
    const client = await import("./client");
    (client.listRecordings as any).mockRejectedValueOnce(new client.PlaudAuthError("401"));
    const { syncPlaud } = await import("./sync");
    const result = await syncPlaud();
    expect(result.error).toMatch(/reconnect/i);
    const lastSet = calls.syncStateSet.at(-1);
    expect(lastSet.lastSyncedAt).toBeUndefined(); // only lastResult written, not checkpoint
  });
});
