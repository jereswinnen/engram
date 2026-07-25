import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { SNIPPET_END, SNIPPET_START } from "./snippet"

const execute = vi.fn()
vi.mock("@/db", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }))
const embedSearchQuery = vi.hoisted(() => vi.fn())
vi.mock("./embeddings", () => ({ embedSearchQuery }))

beforeEach(() => {
  execute.mockReset()
  embedSearchQuery.mockReset()
  embedSearchQuery.mockResolvedValue([0.1, 0.2, 0.3])
  process.env.SEMANTIC_SEARCH_ENABLED = "true"
})

describe("searchRecordings", () => {
  it("returns an empty page for a blank query without hitting the db", async () => {
    const { searchRecordings } = await import("./search")
    expect(await searchRecordings("user-a", "   ")).toEqual({
      results: [],
      pagination: { limit: 20, offset: 0, hasMore: false },
    })
    expect(execute).not.toHaveBeenCalled()
    expect(embedSearchQuery).not.toHaveBeenCalled()
  })

  it("maps passage rows, renders snippets, and reports pagination", async () => {
    execute.mockResolvedValueOnce([
      {
        passage_id: "p1",
        recording_id: "r1",
        title: "Sync",
        created_at: "2026-06-01T10:00:00Z",
        snippet: `the ${SNIPPET_START}budget${SNIPPET_END} talk`,
        start_seconds: 12,
        end_seconds: 42,
        match_type: "hybrid",
        score: 0.03,
        similarity: 0.8,
      },
      {
        passage_id: "p2",
        recording_id: "r2",
        title: "Second",
        created_at: "2026-06-02T10:00:00Z",
        snippet: "another",
        start_seconds: null,
        end_seconds: null,
        match_type: "semantic",
        score: 0.02,
        similarity: 0.7,
      },
    ])
    const { searchRecordings } = await import("./search")
    const page = await searchRecordings("user-a", "budget", { limit: 1 })

    expect(execute).toHaveBeenCalledOnce()
    expect(page.pagination).toEqual({ limit: 1, offset: 0, hasMore: true })
    expect(page.results[0]).toMatchObject({
      passageId: "p1",
      recordingId: "r1",
      snippet: "the <mark>budget</mark> talk",
      matchType: "hybrid",
      startSeconds: 12,
      endSeconds: 42,
    })
    expect(page.results[0].createdAt).toBeInstanceOf(Date)
  })

  it("uses owner-scoped, versioned passage candidates and reciprocal-rank fusion", async () => {
    execute.mockResolvedValueOnce([])
    const { searchRecordings } = await import("./search")

    await searchRecordings("user-b", "private phrase")

    const statement = execute.mock.calls[0][0]
    const rendered = new PgDialect().sqlToQuery(statement).sql
    expect(rendered).toMatch(/WHERE embedding\.owner_id = \$\d+/)
    expect(rendered).toContain("embedding.embedding_version")
    expect(rendered).toContain("UNION ALL")
    expect(rendered).toContain("sum(score)")
  })

  it("keeps keyword passage search available when OpenAI embedding fails", async () => {
    embedSearchQuery.mockRejectedValueOnce(new Error("provider unavailable"))
    execute.mockResolvedValueOnce([
      {
        passage_id: "p1",
        recording_id: "r1",
        title: "Sync",
        created_at: "2026-06-01T10:00:00Z",
        snippet: "budget talk",
        start_seconds: 5,
        end_seconds: 15,
        match_type: "keyword",
        score: 0.01,
        similarity: null,
      },
    ])
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const { searchRecordings } = await import("./search")

    const page = await searchRecordings("user-a", "budget")

    expect(page.results).toHaveLength(1)
    expect(page.results[0].matchType).toBe("keyword")
    const rendered = new PgDialect().sqlToQuery(execute.mock.calls[0][0]).sql
    expect(rendered).toContain("websearch_to_tsquery")
    error.mockRestore()
  })
})
