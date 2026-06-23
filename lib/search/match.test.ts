import { describe, it, expect } from "vitest";
import { firstMatchingSegmentIndex } from "./match";

const segs = [{ text: "Hello there" }, { text: "We discussed the budget" }, { text: "budget again" }];

describe("firstMatchingSegmentIndex", () => {
  it("finds the first segment containing the term (case-insensitive)", () => {
    expect(firstMatchingSegmentIndex(segs, "BUDGET")).toBe(1);
  });
  it("returns -1 when not found", () => {
    expect(firstMatchingSegmentIndex(segs, "zzz")).toBe(-1);
  });
  it("returns -1 for empty/whitespace query", () => {
    expect(firstMatchingSegmentIndex(segs, "  ")).toBe(-1);
  });
});
