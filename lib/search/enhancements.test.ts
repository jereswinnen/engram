import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { SNIPPET_END, SNIPPET_START } from "./snippet"

const execute = vi.fn()
vi.mock("@/db", () => ({
  db: { execute: (...args: unknown[]) => execute(...args) },
}))

beforeEach(() => {
  execute.mockReset()
})

describe("searchGeneratedNotes", () => {
  it("searches only the owner's latest enhancement through its indexed vector", async () => {
    execute.mockResolvedValueOnce([])
    const { searchGeneratedNotes } = await import("./enhancements")

    await searchGeneratedNotes("user-a", "release owner")

    const rendered = new PgDialect().sqlToQuery(execute.mock.calls[0][0]).sql
    expect(rendered).toMatch(/WHERE recording\.owner_id = \$\d+/)
    expect(rendered).toContain("DISTINCT ON (enhancement.recording_id)")
    expect(rendered).toContain("enhancement.search_vector @@")
    expect(rendered).toContain(
      "jsonb_array_elements_text(enhancement.decisions)"
    )
    expect(rendered).toContain("jsonb_array_elements(enhancement.action_items)")
  })

  it("returns plain provenance-labelled evidence and chapter timestamps", async () => {
    execute.mockResolvedValueOnce([
      {
        evidence_id: "e1:chapter:1",
        recording_id: "r1",
        title: "Launch",
        created_at: "2026-07-01T10:00:00Z",
        snippet: `Release ${SNIPPET_START}verification${SNIPPET_END}`,
        source: "chapter",
        start_seconds: "30",
        score: "0.42",
      },
    ])
    const { searchGeneratedNotes } = await import("./enhancements")

    const hits = await searchGeneratedNotes("user-a", "verification")

    expect(hits).toEqual([
      expect.objectContaining({
        evidenceId: "e1:chapter:1",
        recordingId: "r1",
        snippet: "Release verification",
        source: "chapter",
        startSeconds: 30,
        score: 0.42,
      }),
    ])
    expect(hits[0].createdAt).toBeInstanceOf(Date)
  })

  it("does not query the database for blank input", async () => {
    const { searchGeneratedNotes } = await import("./enhancements")
    expect(await searchGeneratedNotes("user-a", "  ")).toEqual([])
    expect(execute).not.toHaveBeenCalled()
  })
})
