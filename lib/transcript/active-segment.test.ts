import { describe, it, expect } from "vitest";
import { activeSegmentIndex } from "./active-segment";

const segs = [
  { start: 0, end: 2 },
  { start: 2, end: 4 },
  { start: 6, end: 8 }, // gap 4–6
];

describe("activeSegmentIndex", () => {
  it("returns -1 before the first segment", () => {
    expect(activeSegmentIndex(segs, -1)).toBe(-1);
  });
  it("returns the segment containing t", () => {
    expect(activeSegmentIndex(segs, 1)).toBe(0);
    expect(activeSegmentIndex(segs, 3)).toBe(1);
    expect(activeSegmentIndex(segs, 7)).toBe(2);
  });
  it("treats start as inclusive, end as exclusive", () => {
    expect(activeSegmentIndex(segs, 2)).toBe(1); // == seg1.start
    expect(activeSegmentIndex(segs, 4)).toBe(1); // == seg1.end, in the gap → last started
  });
  it("returns the last started segment within a gap", () => {
    expect(activeSegmentIndex(segs, 5)).toBe(1);
  });
  it("returns the last segment past the end", () => {
    expect(activeSegmentIndex(segs, 100)).toBe(2);
  });
  it("returns -1 for an empty list", () => {
    expect(activeSegmentIndex([], 5)).toBe(-1);
  });
});
