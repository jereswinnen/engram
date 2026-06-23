import { describe, it, expect, vi, beforeEach } from "vitest";
import { SNIPPET_START, SNIPPET_END } from "./snippet";

const execute = vi.fn();
vi.mock("@/db", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));

beforeEach(() => execute.mockReset());

describe("searchRecordings", () => {
  it("returns [] for a blank query without hitting the db", async () => {
    const { searchRecordings } = await import("./search");
    expect(await searchRecordings("   ")).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });
  it("maps rows and renders snippets", async () => {
    execute.mockResolvedValueOnce([
      { id: "r1", title: "Sync", created_at: "2026-06-01T10:00:00Z", snippet: `the ${SNIPPET_START}budget${SNIPPET_END} talk` },
    ]);
    const { searchRecordings } = await import("./search");
    const hits = await searchRecordings("budget");
    expect(execute).toHaveBeenCalledOnce();
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ id: "r1", title: "Sync", snippet: "the <mark>budget</mark> talk" });
    expect(hits[0].createdAt).toBeInstanceOf(Date);
  });
});
