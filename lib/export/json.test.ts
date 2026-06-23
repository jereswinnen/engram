import { describe, it, expect } from "vitest";
import { recordingToExport } from "./json";

const rec = { id: "r1", title: "Sync", source: "plaud", createdAt: new Date("2026-06-01T10:00:00Z"), durationSeconds: 65, status: "done" };

describe("recordingToExport", () => {
  it("maps full data", () => {
    const out = recordingToExport(
      rec,
      { language: "nld", fullText: "hoi", segments: [{ start: 0, end: 1, text: "hoi" }] },
      { title: "T", overview: "S", actionItems: [{ text: "a" }], keyPoints: ["k"] },
    );
    expect(out).toMatchObject({ id: "r1", title: "Sync", source: "plaud", durationSeconds: 65 });
    expect(out.transcript).toMatchObject({ language: "nld", fullText: "hoi" });
    expect(out.enhancement).toMatchObject({ overview: "S" });
  });
  it("nulls transcript/enhancement when absent", () => {
    const out = recordingToExport(rec, null, null);
    expect(out.transcript).toBeNull();
    expect(out.enhancement).toBeNull();
  });
});
