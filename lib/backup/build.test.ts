import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: any = {};
vi.mock("./store", () => ({
  markReady: vi.fn(async (id: string, key: string, size: number) => { calls.ready = { id, key, size }; }),
  markError: vi.fn(async (id: string, err: string) => { calls.error = { id, err }; }),
}));
vi.mock("@/lib/storage", () => ({
  getStorage: () => ({
    presignedGetUrl: vi.fn(async (k: string) => `https://signed/${k}`),
    putStream: vi.fn(async () => { calls.uploaded = true; }),
  }),
}));
vi.mock("@/lib/export/markdown", () => ({ recordingToMarkdown: () => "MD" }));
vi.mock("@/lib/export/json", () => ({ recordingToExport: () => ({ id: "r" }) }));
vi.mock("@/lib/export/filename", () => ({ exportFilename: () => "x.mp3" }));
vi.mock("@/lib/speakers/store", () => ({ getRecordingSpeakerMap: async () => ({}) }));
vi.mock("@/db", () => ({
  db: {
    query: {
      recordings: { findMany: async () => calls.recs ?? [] },
      transcriptions: { findFirst: async () => null },
      aiEnhancements: { findFirst: async () => null },
    },
  },
}));
// archiver: a fake ZipArchive class recording appends + finalize
// Captures "error" callbacks so tests can verify the listener wiring.
vi.mock("archiver", () => ({
  ZipArchive: class {
    entries: string[] = [];
    _errorCbs: Function[] = [];
    append(_body: unknown, opts: any) { this.entries.push(opts.name); calls.archive = this; }
    on(event: string, cb: Function) {
      if (event === "error") this._errorCbs.push(cb);
      return this;
    }
    async finalize() {
      if (calls.triggerArchiveError) {
        this._errorCbs.forEach((cb: Function) => cb(new Error("archive boom")));
      }
    }
    pipe() { return this; }
  },
}));
// global.fetch for audio
beforeEach(() => {
  calls.recs = [];
  calls.ready = undefined;
  calls.error = undefined;
  calls.uploaded = false;
  calls.triggerArchiveError = false;
  vi.spyOn(global, "fetch").mockResolvedValue(new Response("audiobytes", { status: 200 }));
});

describe("buildBackup", () => {
  it("marks ready, appends manifest, and appends audio entry after processing recordings", async () => {
    calls.recs = [{ id: "r1", title: "A", source: "plaud", createdAt: new Date(), durationSeconds: 1, status: "done", storageKey: "audio/r1.mp3", contentType: "audio/mpeg" }];
    const { buildBackup } = await import("./build");
    await buildBackup("b1");
    expect(calls.ready?.id).toBe("b1");
    expect(calls.archive.entries).toContain("manifest.json");
    expect(calls.archive.entries).toContain("recordings/r1/x.mp3");
    expect(calls.error).toBeUndefined();
  });
  it("skips a recording whose audio fetch fails but still completes", async () => {
    (global.fetch as any).mockResolvedValueOnce(new Response("nope", { status: 404 }));
    calls.recs = [{ id: "r1", title: "A", source: "plaud", createdAt: new Date(), durationSeconds: 1, status: "done", storageKey: "audio/r1.mp3", contentType: "audio/mpeg" }];
    const { buildBackup } = await import("./build");
    await buildBackup("b1");
    expect(calls.ready?.id).toBe("b1"); // still ready, not error
  });
  it("calls markError when the archiver emits an error event", async () => {
    calls.triggerArchiveError = true;
    const { buildBackup } = await import("./build");
    await buildBackup("b2");
    expect(calls.error?.id).toBe("b2");
    expect(calls.error?.err).toContain("archive boom");
  });
});
