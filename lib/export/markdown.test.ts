import { describe, it, expect } from "vitest";
import { recordingToMarkdown } from "./markdown";

const rec = { id: "r1", title: "Weekly Sync", source: "plaud", createdAt: new Date("2026-06-01T10:00:00Z"), durationSeconds: 65, status: "done" };

describe("recordingToMarkdown", () => {
  it("renders title, summary, items, and transcript with [mm:ss]", () => {
    const md = recordingToMarkdown(
      rec,
      { language: "nld", fullText: "x", segments: [{ start: 5, end: 7, text: "Hallo", speaker: "A" }] },
      { title: "Wekelijkse sync", summary: "Samenvatting.", actionItems: ["Jan: offerte"], keyPoints: ["Deadline"] },
    );
    expect(md).toContain("# Weekly Sync");
    expect(md).toContain("## Summary");
    expect(md).toContain("Samenvatting.");
    expect(md).toContain("- Jan: offerte");
    expect(md).toContain("## Transcript");
    expect(md).toContain("**Speaker A** [0:05]: Hallo");
  });
  it("handles missing transcription and enhancement", () => {
    const md = recordingToMarkdown(rec, null, null);
    expect(md).toContain("# Weekly Sync");
    expect(md).toContain("Not yet processed");
    expect(md).toContain("No transcript yet");
  });
  it("omits empty action items / key points sections", () => {
    const md = recordingToMarkdown(rec, null, { title: null, summary: "S", actionItems: [], keyPoints: [] });
    expect(md).not.toContain("## Action items");
    expect(md).not.toContain("## Key points");
  });
});
