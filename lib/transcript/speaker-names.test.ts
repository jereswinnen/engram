import { describe, it, expect } from "vitest";
import { nameForLabel, buildNamedTranscript } from "./speaker-names";

describe("nameForLabel", () => {
  it("maps a known label to its name, falls back to the label otherwise", () => {
    expect(nameForLabel("Speaker 1", { "Speaker 1": "Bjorn" })).toBe("Bjorn");
    expect(nameForLabel("Speaker 2", { "Speaker 1": "Bjorn" })).toBe("Speaker 2");
    expect(nameForLabel("Speaker 1", {})).toBe("Speaker 1");
  });
});
describe("buildNamedTranscript", () => {
  const segs = [{ start: 5, text: "Hoi", speaker: "Speaker 1" }, { start: 65, text: "Ja", speaker: "Speaker 2" }];
  it("renders [mm:ss] Name: text with names substituted", () => {
    const out = buildNamedTranscript(segs, { "Speaker 1": "Bjorn" });
    expect(out).toContain("[0:05] Bjorn: Hoi");
    expect(out).toContain("[1:05] Speaker 2: Ja"); // unmapped → label
  });
  it("uses 'Speaker ?' when a segment has no speaker", () => {
    expect(buildNamedTranscript([{ start: 0, text: "x" }], {})).toContain("Speaker ?: x");
  });
});
