import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PlaudFile } from "./mcp/types";

function rec(p: Partial<PlaudFile> & { fileId: string; startAtMs: number }): PlaudFile {
  return { name: p.fileId, trashed: false, ...p };
}

describe("selectNewRecordings", () => {
  it("keeps untrashed, newer-than-checkpoint, not-already-present, sorted newest-first", async () => {
    const { selectNewRecordings } = await import("./sync");
    const all = [
      rec({ fileId: "old", startAtMs: 100 }),
      rec({ fileId: "dup", startAtMs: 300 }),
      rec({ fileId: "trash", startAtMs: 400, trashed: true }),
      rec({ fileId: "b", startAtMs: 500 }),
      rec({ fileId: "a", startAtMs: 250 }),
    ];
    const out = selectNewRecordings(all, 200, new Set(["dup"]));
    expect(out.map((r) => r.fileId)).toEqual(["b", "a"]);
  });
});

// Orchestration: mock all IO collaborators.
const calls: any = {};
vi.mock("./mcp/client", () => ({
  isConnected: vi.fn(async () => calls.connected ?? true),
  connect: vi.fn(async () => { if (calls.connectThrows) throw new Error("UnauthorizedError"); return { close: vi.fn(async () => {}) }; }),
  listFiles: vi.fn(async () => calls.files ?? []),
  getFile: vi.fn(async (_c: any, id: string) => ({ fileId: id, name: id, startAtMs: 0, trashed: false, presignedUrl: `https://signed/${id}` })),
  downloadAudio: vi.fn(async (url: string) => { if (calls.failUrl === url) throw new Error("download failed"); return { bytes: Buffer.from("x"), contentType: "audio/mpeg" }; }),
}));
vi.mock("@/lib/storage", () => ({
  getStorage: () => ({ put: vi.fn(async (k: string) => {
    if (calls.failPut) throw new Error("storage put failed");
    calls.stored.push(k);
  }) }),
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
    delete: () => ({ where: async () => { calls.deleted.push(true); } }),
    query: {
      recordings: { findMany: async () => calls.existing ?? [], findFirst: async () => calls.findFirstResult ?? { status: "transcribed" } },
      syncState: { findFirst: async () => calls.syncRow ?? { id: "s1", lastSyncedAt: null, lastResult: null, runningSince: null } },
    },
  },
}));

beforeEach(() => {
  calls.stored = []; calls.inserted = []; calls.transcribed = []; calls.enhanced = [];
  calls.syncStateSet = []; calls.existing = []; calls.syncRow = { id: "s1", lastSyncedAt: null, lastResult: null, runningSince: null };
  calls.findFirstResult = undefined; calls.failUrl = undefined; calls.deleted = []; calls.failPut = undefined;
  calls.connected = true; calls.connectThrows = false; calls.files = [];
});

describe("syncPlaud", () => {
  // The mock db.update() pushes every set() into calls.syncStateSet (recording + syncState writes).
  // Find the last syncState write carrying a given key.
  const lastWriteWith = (key: string) => calls.syncStateSet.filter((s: any) => key in s).at(-1);

  it("ingests new recordings through the pipeline and advances the checkpoint", async () => {
    calls.files = [
      { fileId: "f1", name: "One", startAtMs: 1000, trashed: false },
      { fileId: "f2", name: "Two", startAtMs: 2000, trashed: false },
    ];
    const { syncPlaud } = await import("./sync");
    const result = await syncPlaud();
    expect(result.newCount).toBe(2);
    expect(result.failedCount).toBe(0);
    expect(calls.transcribed).toHaveLength(2);
    expect(calls.enhanced).toHaveLength(2);
    // checkpoint advanced to max startAt (2000) and lastResult written
    expect(new Date(lastWriteWith("lastSyncedAt").lastSyncedAt).getTime()).toBe(2000);
    expect(lastWriteWith("lastResult").lastResult.newCount).toBe(2);
  });

  it("skips trashed + already-present and counts skips", async () => {
    calls.existing = [{ plaudFileId: "f1" }];
    calls.files = [
      { fileId: "f1", name: "dup", startAtMs: 1000, trashed: false },
      { fileId: "f2", name: "trash", startAtMs: 2000, trashed: true },
      { fileId: "f3", name: "new", startAtMs: 3000, trashed: false },
    ];
    const { syncPlaud } = await import("./sync");
    const result = await syncPlaud();
    expect(result.newCount).toBe(1);
    expect(result.skippedCount).toBe(2);
    expect(calls.transcribed).toEqual(["rec-0"]);
  });

  it("connect throws → reconnect, checkpoint not advanced", async () => {
    calls.connectThrows = true;
    const { syncPlaud } = await import("./sync");
    const result = await syncPlaud();
    expect(result.error).toMatch(/reconnect/i);
    expect(lastWriteWith("lastSyncedAt")).toBeUndefined(); // only lastResult written, not checkpoint
  });

  it("not connected → error message, checkpoint not advanced", async () => {
    calls.connected = false;
    const { syncPlaud } = await import("./sync");
    const result = await syncPlaud();
    expect(result.error).toMatch(/not connected/i);
    expect(lastWriteWith("lastSyncedAt")).toBeUndefined(); // only lastResult written, not checkpoint
  });

  it("never advances checkpoint past the earliest failure", async () => {
    // f1=1000 succeeds, f2=2000 fails (download throws), f3=3000 succeeds
    // checkpoint must be set to earliestFailureMs - 1 = 1999 so f2 is retried next sync
    calls.failUrl = "https://signed/f2";
    calls.files = [
      { fileId: "f1", name: "One", startAtMs: 1000, trashed: false },
      { fileId: "f2", name: "Two", startAtMs: 2000, trashed: false },
      { fileId: "f3", name: "Three", startAtMs: 3000, trashed: false },
    ];
    const { syncPlaud } = await import("./sync");
    const result = await syncPlaud();
    expect(result.newCount).toBe(2);
    expect(result.failedCount).toBe(1);
    expect(new Date(lastWriteWith("lastSyncedAt").lastSyncedAt).getTime()).toBe(1999);
  });

  it("defers a recording whose audio isn't downloadable yet (presignedUrl null), without failing or advancing past it", async () => {
    // f1=1000 succeeds, f2=2000 has no audio yet → deferred (retry next sync), f3=3000 succeeds.
    const { getFile } = await import("./mcp/client");
    (getFile as any).mockImplementation(async (_c: any, id: string) => ({
      fileId: id, name: id, startAtMs: 0, trashed: false,
      presignedUrl: id === "f2" ? null : `https://signed/${id}`,
    }));
    calls.files = [
      { fileId: "f1", name: "One", startAtMs: 1000, trashed: false },
      { fileId: "f2", name: "Two", startAtMs: 2000, trashed: false },
      { fileId: "f3", name: "Three", startAtMs: 3000, trashed: false },
    ];
    const { syncPlaud } = await import("./sync");
    const result = await syncPlaud();
    expect(result.newCount).toBe(2);
    expect(result.failedCount).toBe(0);
    expect(result.deferredCount).toBe(1);
    expect(result.error).toBeUndefined(); // deferred is not an error
    expect(calls.deleted).toHaveLength(0); // nothing inserted for the deferred one
    // checkpoint must stay before the deferred item (2000) so it's retried → 1999
    expect(new Date(lastWriteWith("lastSyncedAt").lastSyncedAt).getTime()).toBe(1999);
    (getFile as any).mockReset();
    (getFile as any).mockImplementation(async (_c: any, id: string) => ({ fileId: id, name: id, startAtMs: 0, trashed: false, presignedUrl: `https://signed/${id}` }));
  });

  it("does not run enhancement when transcription status is not 'transcribed'", async () => {
    calls.findFirstResult = { status: "error" };
    calls.files = [
      { fileId: "f1", name: "One", startAtMs: 1000, trashed: false },
    ];
    const { syncPlaud } = await import("./sync");
    const result = await syncPlaud();
    expect(result.newCount).toBe(1);
    expect(calls.enhanced).toHaveLength(0);
  });

  it("deletes the orphan row when storage put fails after insert", async () => {
    calls.failPut = true;
    calls.files = [
      { fileId: "f1", name: "One", startAtMs: 1000, trashed: false },
    ];
    const { syncPlaud } = await import("./sync");
    const result = await syncPlaud();
    expect(result.failedCount).toBe(1);
    expect(result.newCount).toBe(0);
    expect(calls.deleted).toHaveLength(1);
  });

  it("skips when a sync is already running (recent runningSince), without processing", async () => {
    calls.syncRow = { id: "s1", lastSyncedAt: null, lastResult: null, runningSince: new Date() };
    calls.files = [{ fileId: "f1", name: "One", startAtMs: 1000, trashed: false }];
    const { syncPlaud } = await import("./sync");
    const result = await syncPlaud();
    expect(result.note).toMatch(/already running/i);
    expect(calls.transcribed).toHaveLength(0);
    // skip records its own result so the UI's "last sync" reflects the attempt...
    expect(lastWriteWith("lastResult").lastResult.note).toMatch(/already running/i);
    // ...but never touches the lock (another run owns it).
    expect(lastWriteWith("runningSince")).toBeUndefined();
  });

  it("takes over a stale lock (older than the 10-min stale window)", async () => {
    calls.syncRow = { id: "s1", lastSyncedAt: null, lastResult: null, runningSince: new Date(Date.now() - 11 * 60 * 1000) };
    calls.files = [{ fileId: "f1", name: "One", startAtMs: 1000, trashed: false }];
    const { syncPlaud } = await import("./sync");
    const result = await syncPlaud();
    expect(result.newCount).toBe(1);
    expect(lastWriteWith("runningSince").runningSince).toBeNull(); // cleared in finally
  });

  it("surfaces a processing error (imported but parked in 'error' status) without blocking the checkpoint", async () => {
    calls.findFirstResult = { status: "error", errorMessage: "scribe 500" };
    calls.files = [
      { fileId: "f1", name: "One", startAtMs: 1000, trashed: false },
      { fileId: "f2", name: "Two", startAtMs: 2000, trashed: false },
    ];
    const { syncPlaud } = await import("./sync");
    const result = await syncPlaud();
    expect(result.newCount).toBe(2); // still imported
    expect(result.processingErrorCount).toBe(2);
    expect(result.failedCount).toBe(0);
    expect(result.error).toBeUndefined(); // not a top-level error — checkpoint still advances
    expect(new Date(lastWriteWith("lastSyncedAt").lastSyncedAt).getTime()).toBe(2000);
  });

  it("clears runningSince in finally even when not connected", async () => {
    calls.connected = false;
    const { syncPlaud } = await import("./sync");
    await syncPlaud();
    expect(lastWriteWith("runningSince").runningSince).toBeNull(); // lock acquired then cleared
  });

  it("processes the whole batch concurrently and advances the checkpoint to the newest", async () => {
    calls.files = Array.from({ length: 12 }, (_, i) => ({ fileId: `f${i}`, name: `R${i}`, startAtMs: (i + 1) * 1000, trashed: false }));
    const { syncPlaud } = await import("./sync");
    const result = await syncPlaud();
    expect(result.newCount).toBe(12);
    expect(result.failedCount).toBe(0);
    expect(calls.transcribed).toHaveLength(12);
    expect(new Date(lastWriteWith("lastSyncedAt").lastSyncedAt).getTime()).toBe(12000); // newest
  });

  it("stops at the time budget and holds the checkpoint before the unprocessed (oldest) items", async () => {
    process.env.PLAUD_SYNC_BUDGET_MS = "-1"; // already over budget on the first check
    try {
      calls.files = [
        { fileId: "f1", name: "One", startAtMs: 1000, trashed: false },
        { fileId: "f2", name: "Two", startAtMs: 2000, trashed: false },
      ];
      const { syncPlaud } = await import("./sync");
      const result = await syncPlaud();
      expect(result.newCount).toBe(0); // budget gone before any item ran
      expect(calls.transcribed).toHaveLength(0);
      // checkpoint must stay before the oldest unprocessed item (1000) → 999
      expect(new Date(lastWriteWith("lastSyncedAt").lastSyncedAt).getTime()).toBe(999);
    } finally {
      delete process.env.PLAUD_SYNC_BUDGET_MS;
    }
  });
});
