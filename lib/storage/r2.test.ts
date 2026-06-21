import { describe, it, expect } from "vitest";
import { buildAudioKey } from "./types";

describe("buildAudioKey", () => {
  it("builds a namespaced key preserving extension", () => {
    expect(buildAudioKey("abc-123", "meeting.mp3")).toBe("audio/abc-123.mp3");
  });
  it("falls back to .bin when no extension", () => {
    expect(buildAudioKey("abc-123", "noext")).toBe("audio/abc-123.bin");
  });
});
