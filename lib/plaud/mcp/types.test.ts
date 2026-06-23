import { describe, it, expect } from "vitest";
import { parseToolJson, mapFile, mapFileDetail } from "./types";

describe("parseToolJson", () => {
  it("concatenates text blocks and JSON-parses", () => {
    const result = { content: [{ type: "text", text: '{"files":' }, { type: "text", text: "[]}" }, { type: "image" }] };
    expect(parseToolJson(result)).toEqual({ files: [] });
  });

  it("throws with raw MCP error text when result.isError is true", () => {
    const result = { isError: true, content: [{ type: "text", text: "MCP error: invalid arguments" }] };
    expect(() => parseToolJson(result)).toThrow(/MCP error: invalid arguments/);
  });

  it("throws with raw text when content is not valid JSON", () => {
    const result = { content: [{ type: "text", text: "oops not json" }] };
    expect(() => parseToolJson(result)).toThrow(/oops not json/);
  });
});

describe("mapFile", () => {
  it("maps documented fields and computes startAtMs", () => {
    const f = mapFile({ id: "f1", name: "Sync", start_at: "2026-06-01T10:00:00Z", duration: 65000 });
    expect(f).toMatchObject({ fileId: "f1", name: "Sync", durationMs: 65000, trashed: false });
    expect(f.startAtMs).toBe(Date.parse("2026-06-01T10:00:00Z"));
  });
  it("tolerates field-name variants and throws on no date", () => {
    expect(mapFile({ file_id: 2, start_time: "2026-06-02T00:00:00Z" }).fileId).toBe("2");
    expect(() => mapFile({ id: "x" })).toThrow(/date/);
  });
});

describe("mapFileDetail", () => {
  it("maps the presigned url when present", () => {
    expect(mapFileDetail({ id: "f1", start_at: "2026-06-01T10:00:00Z", presigned_url: "https://signed/a" }).presignedUrl).toBe("https://signed/a");
  });
  it("returns null (not a throw) when the audio isn't downloadable yet, so the sync can defer it", () => {
    expect(mapFileDetail({ id: "f1", start_at: "2026-06-01T10:00:00Z" }).presignedUrl).toBeNull();
    expect(mapFileDetail({ id: "f1", start_at: "2026-06-01T10:00:00Z", presigned_url: null }).presignedUrl).toBeNull();
  });
});
