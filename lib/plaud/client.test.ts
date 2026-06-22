import { describe, it, expect, vi, afterEach } from "vitest";
import { mapRecording, mapRecordingDetail } from "./types";

afterEach(() => { vi.restoreAllMocks(); delete process.env.PLAUD_API_BASE; });

describe("mapRecording", () => {
  it("maps raw fields and computes startAtMs", () => {
    const r = mapRecording({ id: "f1", name: "Sync", start_at: "2026-06-01T10:00:00Z", duration: 65000 });
    expect(r).toMatchObject({ fileId: "f1", name: "Sync", durationMs: 65000, trashed: false });
    expect(r.startAtMs).toBe(Date.parse("2026-06-01T10:00:00Z"));
  });
  it("falls back across field-name variants and detects trashed", () => {
    const r = mapRecording({ file_id: 2, start_time: "2026-06-02T00:00:00Z", is_trash: true });
    expect(r.fileId).toBe("2");
    expect(r.name).toBe("Untitled");
    expect(r.trashed).toBe(true);
  });
  it("mapRecordingDetail picks the signed audio url", () => {
    const d = mapRecordingDetail({ id: "f1", start_at: "2026-06-01T10:00:00Z", presigned_url: "https://signed/a.mp3" });
    expect(d.audioUrl).toBe("https://signed/a.mp3");
  });
});

describe("client http", () => {
  it("listRecordings sends bearer auth and maps results", async () => {
    const { listRecordings } = await import("./client");
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "f1", start_at: "2026-06-01T10:00:00Z" }] }), { status: 200 }),
    );
    const res = await listRecordings("eyJ-token");
    expect(res).toHaveLength(1);
    expect(res[0].fileId).toBe("f1");
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer eyJ-token");
  });
  it("normalizes a token that already has a bearer prefix", async () => {
    const { listRecordings } = await import("./client");
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    await listRecordings("bearer eyJ-token");
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("bearer eyJ-token");
  });
  it("throws PlaudAuthError on 401", async () => {
    const { listRecordings, PlaudAuthError } = await import("./client");
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("nope", { status: 401 }));
    await expect(listRecordings("bad")).rejects.toBeInstanceOf(PlaudAuthError);
  });
  it("throws on other non-ok responses", async () => {
    const { listRecordings } = await import("./client");
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));
    await expect(listRecordings("t")).rejects.toThrow(/500/);
  });
  it("validateToken returns false on auth error", async () => {
    const { validateToken } = await import("./client");
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("nope", { status: 401 }));
    expect(await validateToken("bad")).toBe(false);
  });
  it("skips individually-bad records and returns only the good ones", async () => {
    const { listRecordings } = await import("./client");
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [
        { id: "f1", start_at: "2026-06-01T10:00:00Z" }, // good
        { id: "f2" },                                     // no date → mapRecording throws
      ] }), { status: 200 }),
    );
    const res = await listRecordings("token");
    expect(res).toHaveLength(1);
    expect(res[0].fileId).toBe("f1");
  });
  it("throws when all records in a non-empty list are unmappable", async () => {
    const { listRecordings } = await import("./client");
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [
        { id: "f1" }, // no date → throws
        { id: "f2" }, // no date → throws
      ] }), { status: 200 }),
    );
    await expect(listRecordings("token")).rejects.toThrow();
  });
});
