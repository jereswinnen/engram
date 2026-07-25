import { describe, it, expect, vi, beforeEach } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { SNIPPET_START, SNIPPET_END } from "./snippet"

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
  it("returns [] for a blank query without hitting the db", async () => {
    const { searchRecordings } = await import("./search")
    expect(await searchRecordings("user-a", "   ")).toEqual([])
    expect(execute).not.toHaveBeenCalled()
    expect(embedSearchQuery).not.toHaveBeenCalled()
  })
  it("maps rows and renders snippets", async () => {
    execute.mockResolvedValueOnce([
      {
        id: "r1",
        title: "Sync",
        created_at: "2026-06-01T10:00:00Z",
        snippet: `the ${SNIPPET_START}budget${SNIPPET_END} talk`,
        score: 0.5,
      },
    ])
    execute.mockResolvedValueOnce([])
    const { searchRecordings } = await import("./search")
    const hits = await searchRecordings("user-a", "budget")
    expect(execute).toHaveBeenCalledTimes(2)
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      id: "r1",
      title: "Sync",
      snippet: "the <mark>budget</mark> talk",
      matchType: "keyword",
    })
    expect(hits[0].createdAt).toBeInstanceOf(Date)
  })

  it("groups transcript/title matches underneath the owner predicate", async () => {
    execute.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const { searchRecordings } = await import("./search")

    await searchRecordings("user-b", "private phrase")

    const statement = execute.mock.calls[0][0]
    const rendered = new PgDialect().sqlToQuery(statement).sql
    expect(rendered).toMatch(
      /WHERE \(r\.owner_id = \$\d+ OR \(\$\d+ AND r\.owner_id IS NULL\)\)\s+AND \(\s+t\.search_vector/
    )
  })

  it("adds owner-scoped semantic matches from the current embedding model", async () => {
    execute.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: "r2",
        title: "Planning",
        created_at: "2026-06-02T10:00:00Z",
        snippet: "We discussed how to launch the mobile application.",
        start_seconds: 42,
        score: 0.81,
      },
    ])
    const { searchRecordings } = await import("./search")

    const hits = await searchRecordings("user-c", "iPhone roadmap")

    expect(embedSearchQuery).toHaveBeenCalledWith("iPhone roadmap")
    expect(hits).toEqual([
      expect.objectContaining({
        id: "r2",
        matchType: "semantic",
        startSeconds: 42,
        score: 0.81,
      }),
    ])
    const semanticStatement = execute.mock.calls[1][0]
    const rendered = new PgDialect().sqlToQuery(semanticStatement).sql
    expect(rendered).toMatch(/WHERE embedding\.owner_id = \$\d+/)
    expect(rendered).toContain("embedding.embedding_model")
  })

  it("keeps keyword search available when OpenAI embedding fails", async () => {
    embedSearchQuery.mockRejectedValueOnce(new Error("provider unavailable"))
    execute.mockResolvedValueOnce([
      {
        id: "r1",
        title: "Sync",
        created_at: "2026-06-01T10:00:00Z",
        snippet: "budget talk",
        score: 0.4,
      },
    ])
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const { searchRecordings } = await import("./search")

    const hits = await searchRecordings("user-a", "budget")

    expect(hits).toHaveLength(1)
    expect(hits[0].matchType).toBe("keyword")
    error.mockRestore()
  })
})
