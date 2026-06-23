import { describe, it, expect } from "vitest";
import { formatLabel, nameForLabel, buildNamedTranscript } from "./speaker-names";

describe("formatLabel", () => {
  it("converts raw zero-based Scribe labels to 1-based Speaker N", () => {
    expect(formatLabel("speaker_0")).toBe("Speaker 1");
    expect(formatLabel("speaker_1")).toBe("Speaker 2");
  });
  it("passes through already-prettified labels unchanged", () => {
    expect(formatLabel("Speaker 2")).toBe("Speaker 2");
    expect(formatLabel("Speaker ?")).toBe("Speaker ?");
  });
  it("prefixes arbitrary labels with Speaker", () => {
    expect(formatLabel("A")).toBe("Speaker A");
  });
});

describe("nameForLabel", () => {
  it("maps a known label to its name", () => {
    expect(nameForLabel("Speaker 1", { "Speaker 1": "Bjorn" })).toBe("Bjorn");
    // raw label as map key — lookup uses the raw key unchanged
    expect(nameForLabel("speaker_0", { "speaker_0": "Alice" })).toBe("Alice");
  });
  it("prettifies unmapped raw labels via formatLabel", () => {
    expect(nameForLabel("speaker_0", {})).toBe("Speaker 1");
    expect(nameForLabel("A", {})).toBe("Speaker A");
  });
  it("passes already-prettified unmapped labels through unchanged", () => {
    expect(nameForLabel("Speaker 2", { "Speaker 1": "Bjorn" })).toBe("Speaker 2");
    expect(nameForLabel("Speaker 1", {})).toBe("Speaker 1");
  });
});

describe("buildNamedTranscript", () => {
  it("renders [mm:ss] Name: text with names substituted", () => {
    const segs = [{ start: 5, text: "Hoi", speaker: "speaker_0" }, { start: 65, text: "Ja", speaker: "speaker_1" }];
    const out = buildNamedTranscript(segs, { "speaker_0": "Bjorn" });
    expect(out).toContain("[0:05] Bjorn: Hoi");
    expect(out).toContain("[1:05] Speaker 2: Ja"); // unmapped → formatLabel → "Speaker 2"
  });
  it("prettifies unmapped raw speaker labels", () => {
    const segs = [{ start: 0, text: "Hi", speaker: "speaker_0" }];
    expect(buildNamedTranscript(segs, {})).toContain("[0:00] Speaker 1: Hi");
  });
  it("uses 'Speaker ?' when a segment has no speaker", () => {
    expect(buildNamedTranscript([{ start: 0, text: "x" }], {})).toContain("Speaker ?: x");
  });
});
