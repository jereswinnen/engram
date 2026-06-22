import { describe, it, expect, vi } from "vitest";

// Prevent transitive side-effects from auth-store → db / config
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/config", () => ({ config: { plaudRedirectUrl: () => "https://example.com/api/plaud/callback" } }));
vi.mock("./auth-store", () => ({ plaudAuthStore: {} }));

import { listFiles, getFile } from "./client";

function toolResult(obj: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(obj) }] };
}

describe("listFiles", () => {
  it("calls list_files and maps results", async () => {
    const client = { callTool: vi.fn(async () => toolResult({ files: [{ id: "f1", start_at: "2026-06-01T10:00:00Z" }] })) } as any;
    const files = await listFiles(client, { date_from: "2026-05-01T00:00:00Z" });
    expect(client.callTool).toHaveBeenCalledWith({ name: "list_files", arguments: { date_from: "2026-05-01T00:00:00Z" } });
    expect(files).toHaveLength(1);
    expect(files[0].fileId).toBe("f1");
  });
  it("handles array / data / list response shapes", async () => {
    const client = { callTool: vi.fn(async () => toolResult({ data: [{ id: "a", start_at: "2026-06-01T10:00:00Z" }] })) } as any;
    expect((await listFiles(client)).map((f) => f.fileId)).toEqual(["a"]);
  });
});

describe("getFile", () => {
  it("calls get_file and maps the detail", async () => {
    const client = { callTool: vi.fn(async () => toolResult({ id: "f1", start_at: "2026-06-01T10:00:00Z", presigned_url: "https://signed/f1.mp3" })) } as any;
    const detail = await getFile(client, "f1");
    expect(client.callTool).toHaveBeenCalledWith({ name: "get_file", arguments: { id: "f1" } });
    expect(detail.presignedUrl).toBe("https://signed/f1.mp3");
  });
});
