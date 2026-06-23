/**
 * Streaming integrity test for buildBackup.
 *
 * Drives the REAL archiver (no vi.mock("archiver")) through a fake putStream that
 * genuinely consumes the Readable via `for await`, then asserts the byte count
 * received by putStream equals the size reported to markReady.
 *
 * This is the regression guard for the PassThrough+data-listener race that caused
 * truncated uploads: with the bug, size > received; with the fix, size === received.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// State captured by mocks — const so vi.mock factories close over the same reference.
const state: {
  ready?: { id: string; key: string; size: number };
  error?: { id: string; err: string };
  received: number;
} = { received: 0 };

vi.mock("./store", () => ({
  markReady: vi.fn(async (id: string, key: string, size: number) => {
    state.ready = { id, key, size };
  }),
  markError: vi.fn(async (id: string, err: string) => {
    state.error = { id, err };
  }),
}));

// putStream genuinely consumes the Readable via for-await (paused-mode pull),
// mirroring how @aws-sdk/lib-storage Upload reads the body.
vi.mock("@/lib/storage", () => ({
  getStorage: () => ({
    presignedGetUrl: vi.fn(async (k: string) => `https://signed/${k}`),
    putStream: vi.fn(async (_key: string, body: AsyncIterable<Buffer>) => {
      await new Promise((resolve) => setImmediate(resolve)); // mirror lib-storage Upload: attach the for-await a tick later
      let received = 0;
      for await (const chunk of body) {
        received += (chunk as Buffer).length;
      }
      state.received = received;
    }),
  }),
}));

vi.mock("@/lib/export/markdown", () => ({
  recordingToMarkdown: () => "# Test Transcript\n\nSome spoken content here.",
}));
vi.mock("@/lib/export/json", () => ({
  recordingToExport: () => ({ id: "r1", title: "Test Recording", source: "plaud" }),
}));
vi.mock("@/lib/export/filename", () => ({ exportFilename: () => "audio.mp3" }));
vi.mock("@/lib/speakers/store", () => ({ getRecordingSpeakerMap: async () => ({}) }));

vi.mock("@/db", () => ({
  db: {
    query: {
      recordings: {
        findMany: async () => [
          {
            id: "r1",
            title: "Test Recording",
            source: "plaud",
            createdAt: new Date("2024-01-15T10:00:00Z"),
            durationSeconds: 120,
            status: "done",
            storageKey: "audio/r1.mp3",
            contentType: "audio/mpeg",
          },
        ],
      },
      transcriptions: { findFirst: async () => null },
      aiEnhancements: { findFirst: async () => null },
    },
  },
}));

beforeEach(() => {
  state.received = 0;
  state.ready = undefined;
  state.error = undefined;
  // Return a small fake audio payload so the archiver receives a real Readable body.
  vi.spyOn(global, "fetch").mockResolvedValue(
    new Response("fake-audio-payload-for-streaming-test", { status: 200 }),
  );
});

describe("buildBackup streaming integrity", () => {
  it("delivered byte count to putStream matches size reported to markReady", async () => {
    const { buildBackup } = await import("./build");
    await buildBackup("bX");

    expect(state.error, "markError was called — backup errored unexpectedly").toBeUndefined();
    expect(state.ready, "markReady was never called — backup did not complete").toBeTruthy();
    expect(state.received, "putStream received zero bytes").toBeGreaterThan(0);
    // THE REGRESSION GUARD: with the old PassThrough+data-listener race,
    // size (counting listener) > received (upload saw truncated stream).
    // With the counting Transform fix, every byte counted is a byte delivered.
    expect(state.received).toBe(state.ready!.size);
  });
});
