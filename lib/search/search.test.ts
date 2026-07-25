import { describe, it, expect, vi, beforeEach } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { SNIPPET_START, SNIPPET_END } from "./snippet"

const execute = vi.fn()
vi.mock("@/db", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }))

beforeEach(() => execute.mockReset())

describe("searchRecordings", () => {
  it("returns [] for a blank query without hitting the db", async () => {
    const { searchRecordings } = await import("./search")
    expect(await searchRecordings("user-a", "   ")).toEqual([])
    expect(execute).not.toHaveBeenCalled()
  })
  it("maps rows and renders snippets", async () => {
    execute.mockResolvedValueOnce([
      {
        id: "r1",
        title: "Sync",
        created_at: "2026-06-01T10:00:00Z",
        snippet: `the ${SNIPPET_START}budget${SNIPPET_END} talk`,
      },
    ])
    const { searchRecordings } = await import("./search")
    const hits = await searchRecordings("user-a", "budget")
    expect(execute).toHaveBeenCalledOnce()
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      id: "r1",
      title: "Sync",
      snippet: "the <mark>budget</mark> talk",
    })
    expect(hits[0].createdAt).toBeInstanceOf(Date)
  })

  it("groups transcript/title matches underneath the owner predicate", async () => {
    execute.mockResolvedValueOnce([])
    const { searchRecordings } = await import("./search")

    await searchRecordings("user-b", "private phrase")

    const statement = execute.mock.calls[0][0]
    const rendered = new PgDialect().sqlToQuery(statement).sql
    expect(rendered).toMatch(
      /WHERE \(r\.owner_id = \$\d+ OR \(\$\d+ AND r\.owner_id IS NULL\)\)\s+AND \(\s+t\.search_vector/
    )
  })
})
