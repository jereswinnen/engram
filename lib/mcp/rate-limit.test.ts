import { describe, expect, it, vi } from "vitest"
import type { SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"

const dbMock = vi.hoisted(() => ({ execute: vi.fn() }))

vi.mock("@/db", () => ({ db: dbMock }))

import { checkMcpRateLimit, rateLimitKey } from "./rate-limit"

describe("MCP durable rate limiting", () => {
  it("preserves the Drizzle database receiver for the default executor", async () => {
    dbMock.execute.mockImplementationOnce(function (this: unknown) {
      if (this !== dbMock) throw new TypeError("Database receiver was lost")
      return Promise.resolve([{ request_count: 1 }])
    })

    const result = await checkMcpRateLimit({
      userId: "user-a",
      clientId: "codex",
      tool: "search",
    })

    expect(result.allowed).toBe(true)
    expect(dbMock.execute).toHaveBeenCalledOnce()
  })

  it("derives opaque keys isolated by user, client, and tool", () => {
    const base = {
      userId: "user-a",
      clientId: "codex",
      tool: "search" as const,
    }
    const digest = rateLimitKey(base)
    expect(digest).toMatch(/^[a-f0-9]{64}$/)
    expect(digest).not.toContain("user-a")
    expect(rateLimitKey({ ...base, userId: "user-b" })).not.toBe(digest)
    expect(rateLimitKey({ ...base, clientId: "claude" })).not.toBe(digest)
    expect(rateLimitKey({ ...base, tool: "fetch" })).not.toBe(digest)
  })

  it("atomically increments one fixed-window Postgres bucket", async () => {
    const execute = vi.fn(async (statement: unknown) => {
      void statement
      return [{ request_count: 20 }]
    })
    const result = await checkMcpRateLimit(
      { userId: "user-a", clientId: "codex", tool: "search" },
      { now: new Date("2026-07-30T10:00:45Z"), execute: execute as never }
    )

    const rendered = new PgDialect().sqlToQuery(
      execute.mock.calls[0][0] as SQL
    )
    expect(rendered.sql).toContain("ON CONFLICT (key_digest, window_start)")
    expect(rendered.sql).toContain("request_count + 1")
    expect(rendered.sql).toContain("$2::timestamp")
    expect(rendered.params).toEqual([
      expect.any(String),
      "2026-07-30T10:00:00.000Z",
      "2026-07-30T10:05:00.000Z",
    ])
    expect(result).toEqual({
      allowed: true,
      limit: 20,
      remaining: 0,
      retryAfterSeconds: 15,
    })
  })

  it("denies calls above the tool limit and can clean expired buckets", async () => {
    const execute = vi
      .fn((statement: unknown): Promise<Array<{ request_count: number }>> => {
        void statement
        return Promise.resolve([])
      })
      .mockResolvedValueOnce([{ request_count: 21 }])
      .mockResolvedValueOnce([])
    const result = await checkMcpRateLimit(
      { userId: "user-a", clientId: "codex", tool: "search" },
      {
        now: new Date("2026-07-30T10:00:59.500Z"),
        execute: execute as never,
        cleanup: true,
      }
    )

    expect(result.allowed).toBe(false)
    expect(result.retryAfterSeconds).toBe(1)
    const cleanup = new PgDialect().sqlToQuery(
      execute.mock.calls[1][0] as SQL
    )
    expect(cleanup.sql).toContain("DELETE FROM mcp_rate_limit_buckets")
    expect(cleanup.sql).toContain("$1::timestamp")
    expect(cleanup.params).toEqual(["2026-07-30T10:00:59.500Z"])
  })
})
