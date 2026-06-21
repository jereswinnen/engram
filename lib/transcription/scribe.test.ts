import { describe, it, expect } from "vitest";
import { wordsToSegments } from "./scribe";

describe("wordsToSegments", () => {
  it("groups consecutive words by speaker", () => {
    const segs = wordsToSegments([
      { text: "Hallo", start: 0, end: 1, speaker_id: "A" },
      { text: " daar", start: 1, end: 2, speaker_id: "A" },
      { text: "Goeie", start: 2, end: 3, speaker_id: "B" },
    ]);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ speaker: "A", text: "Hallo daar", start: 0, end: 2 });
    expect(segs[1]).toMatchObject({ speaker: "B", text: "Goeie", start: 2, end: 3 });
  });

  it("drops audio_event tokens", () => {
    const segs = wordsToSegments([
      { text: "(gelach)", type: "audio_event", speaker_id: "A" },
      { text: "Hoi", start: 1, end: 2, type: "word", speaker_id: "A" },
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0].text).toBe("Hoi");
  });
});
