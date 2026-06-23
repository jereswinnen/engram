import { describe, it, expect } from "vitest";
import { recordingToExport } from "./json";

const rec = { id: "r1", title: "Sync", source: "plaud", createdAt: new Date("2026-06-01T10:00:00Z"), durationSeconds: 65, status: "done" };

const fullEnh = {
  title: "T",
  overview: "S",
  actionItems: [{ text: "a", owner: "Jan", due: "2026-06-10" }],
  keyPoints: ["k"],
  decisions: ["Budget approved"],
  chapters: [{ title: "Opening", gist: "Intro", startSeconds: 0 }],
  openQuestions: ["What next?"],
};

describe("recordingToExport", () => {
  it("maps full data", () => {
    const out = recordingToExport(
      rec,
      { language: "nld", fullText: "hoi", segments: [{ start: 0, end: 1, text: "hoi" }] },
      { title: "T", overview: "S", actionItems: [{ text: "a" }], keyPoints: ["k"], decisions: [], chapters: [], openQuestions: [] },
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

  it("includes decisions, chapters, openQuestions in enhancement", () => {
    const out = recordingToExport(rec, null, fullEnh);
    expect(out.enhancement?.decisions).toEqual(["Budget approved"]);
    expect(out.enhancement?.chapters).toEqual([{ title: "Opening", gist: "Intro", startSeconds: 0 }]);
    expect(out.enhancement?.openQuestions).toEqual(["What next?"]);
  });

  it("includes actionItems with owner and due in enhancement", () => {
    const out = recordingToExport(rec, null, fullEnh);
    expect(out.enhancement?.actionItems).toEqual([{ text: "a", owner: "Jan", due: "2026-06-10" }]);
  });

  it("resolves transcript segment speaker labels via speakerMap", () => {
    const out = recordingToExport(
      rec,
      { language: "nld", fullText: "hoi", segments: [{ start: 0, end: 1, text: "hoi", speaker: "A" }, { start: 2, end: 3, text: "dag", speaker: "B" }] },
      null,
      { A: "Alice", B: "Bob" },
    );
    expect(out.transcript?.segments[0].speaker).toBe("Alice");
    expect(out.transcript?.segments[1].speaker).toBe("Bob");
  });

  it("prettifies unmapped speaker label when not in speakerMap", () => {
    const out = recordingToExport(
      rec,
      { language: "nld", fullText: "hoi", segments: [{ start: 0, end: 1, text: "hoi", speaker: "C" }] },
      null,
      { A: "Alice" },
    );
    expect(out.transcript?.segments[0].speaker).toBe("Speaker C");
  });

  it("leaves speaker undefined when segment has no speaker", () => {
    const out = recordingToExport(
      rec,
      { language: "nld", fullText: "hoi", segments: [{ start: 0, end: 1, text: "hoi" }] },
      null,
      { A: "Alice" },
    );
    expect(out.transcript?.segments[0].speaker).toBeUndefined();
  });
});
