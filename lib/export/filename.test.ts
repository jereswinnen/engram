import { describe, it, expect } from "vitest";
import { exportFilename } from "./filename";

describe("exportFilename", () => {
  it("slugifies the title and appends the extension", () => {
    expect(exportFilename("Weekly Sync!", "abc-123", "md")).toBe("weekly-sync.md");
  });
  it("falls back to the id when the title slugifies to empty", () => {
    expect(exportFilename("!!!", "abc-123", "json")).toBe("abc-123.json");
  });
  it("collapses spaces/unsafe chars and trims", () => {
    expect(exportFilename("  A/B:  C  ", "id", "md")).toBe("a-b-c.md");
  });
});
