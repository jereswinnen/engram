import { describe, it, expect } from "vitest";
import { recordingToMarkdown } from "./markdown";

const rec = { id: "r1", title: "Weekly Sync", source: "plaud", createdAt: new Date("2026-06-01T10:00:00Z"), durationSeconds: 65, status: "done" };

const fullEnh = {
  title: "Wekelijkse sync",
  overview: "Samenvatting.",
  actionItems: [{ text: "Offerte sturen", owner: "Jan", due: "2026-06-10" }],
  keyPoints: ["Deadline"],
  decisions: ["Budget goedgekeurd", "Nieuwe leverancier gekozen"],
  chapters: [
    { title: "Opening", gist: "Welkom en agenda", startSeconds: 0 },
    { title: "Budget", gist: "Financieel overzicht", startSeconds: 120 },
    { title: "Afsluiting", gist: "Actiepunten besproken" },
  ],
  openQuestions: ["Wie neemt contact op met de klant?", "Wanneer is de deadline?"],
};

describe("recordingToMarkdown", () => {
  it("renders title, summary, items, and transcript with [mm:ss]", () => {
    const md = recordingToMarkdown(
      rec,
      { language: "nld", fullText: "x", segments: [{ start: 5, end: 7, text: "Hallo", speaker: "A" }] },
      { title: "Wekelijkse sync", overview: "Samenvatting.", actionItems: [{ text: "Jan: offerte" }], keyPoints: ["Deadline"], decisions: [], chapters: [], openQuestions: [] },
    );
    expect(md).toContain("# Weekly Sync");
    expect(md).toContain("## Summary");
    expect(md).toContain("Samenvatting.");
    expect(md).toContain("- Jan: offerte");
    expect(md).toContain("## Transcript");
    expect(md).toContain("**A** [0:05]: Hallo");
  });

  it("handles missing transcription and enhancement", () => {
    const md = recordingToMarkdown(rec, null, null);
    expect(md).toContain("# Weekly Sync");
    expect(md).toContain("Not yet processed");
    expect(md).toContain("No transcript yet");
  });

  it("omits empty action items / key points sections", () => {
    const md = recordingToMarkdown(rec, null, { title: null, overview: "S", actionItems: [], keyPoints: [], decisions: [], chapters: [], openQuestions: [] });
    expect(md).not.toContain("## Action items");
    expect(md).not.toContain("## Key points");
  });

  it("renders action item with owner and due date", () => {
    const md = recordingToMarkdown(
      rec,
      null,
      { title: null, overview: "S", actionItems: [{ text: "Offerte sturen", owner: "Jan", due: "2026-06-10" }], keyPoints: [], decisions: [], chapters: [], openQuestions: [] },
    );
    expect(md).toContain("- Offerte sturen (Jan) — due 2026-06-10");
  });

  it("renders ## Decisions section when present", () => {
    const md = recordingToMarkdown(rec, null, fullEnh);
    expect(md).toContain("## Decisions");
    expect(md).toContain("- Budget goedgekeurd");
    expect(md).toContain("- Nieuwe leverancier gekozen");
  });

  it("omits ## Decisions when empty", () => {
    const md = recordingToMarkdown(rec, null, { ...fullEnh, decisions: [] });
    expect(md).not.toContain("## Decisions");
  });

  it("renders ## Chapters with title, gist, and [mm:ss] when startSeconds present", () => {
    const md = recordingToMarkdown(rec, null, fullEnh);
    expect(md).toContain("## Chapters");
    expect(md).toContain("**Opening** [0:00] — Welkom en agenda");
    expect(md).toContain("**Budget** [2:00] — Financieel overzicht");
    expect(md).toContain("**Afsluiting** — Actiepunten besproken");
  });

  it("omits ## Chapters when empty", () => {
    const md = recordingToMarkdown(rec, null, { ...fullEnh, chapters: [] });
    expect(md).not.toContain("## Chapters");
  });

  it("renders ## Open questions section when present", () => {
    const md = recordingToMarkdown(rec, null, fullEnh);
    expect(md).toContain("## Open questions");
    expect(md).toContain("- Wie neemt contact op met de klant?");
    expect(md).toContain("- Wanneer is de deadline?");
  });

  it("omits ## Open questions when empty", () => {
    const md = recordingToMarkdown(rec, null, { ...fullEnh, openQuestions: [] });
    expect(md).not.toContain("## Open questions");
  });

  it("resolves transcript speaker labels via speakerMap", () => {
    const md = recordingToMarkdown(
      rec,
      { language: "nld", fullText: "x", segments: [{ start: 5, end: 7, text: "Hallo", speaker: "A" }, { start: 8, end: 10, text: "Dag", speaker: "B" }] },
      null,
      { A: "Alice", B: "Bob" },
    );
    expect(md).toContain("**Alice** [0:05]: Hallo");
    expect(md).toContain("**Bob** [0:08]: Dag");
  });

  it("falls back to raw label when speaker not in speakerMap", () => {
    const md = recordingToMarkdown(
      rec,
      { language: "nld", fullText: "x", segments: [{ start: 5, end: 7, text: "Hallo", speaker: "C" }] },
      null,
      { A: "Alice" },
    );
    expect(md).toContain("**C** [0:05]: Hallo");
  });

  it("uses 'Speaker ?' when speaker label is absent and no map", () => {
    const md = recordingToMarkdown(
      rec,
      { language: "nld", fullText: "x", segments: [{ start: 5, end: 7, text: "Hallo" }] },
      null,
    );
    expect(md).toContain("**Speaker ?** [0:05]: Hallo");
  });
});
