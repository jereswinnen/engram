import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/db", () => ({ db: { execute: vi.fn() } }))

import type { AuthPrincipal } from "@/lib/auth/principal"
import { runMcpTool, type McpToolContext } from "./shared"

const principal: AuthPrincipal = {
  userId: "user-a",
  mechanism: "oauth",
  scopes: new Set(["transcripts:search"]),
  clientId: "codex",
}

function context(overrides: Partial<McpToolContext> = {}): McpToolContext {
  return {
    principal,
    appUrl: "https://engram.example",
    requestId: "request-1",
    rateLimit: async () => ({
      allowed: true,
      limit: 20,
      remaining: 19,
      retryAfterSeconds: 60,
    }),
    logEvent: () => undefined,
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe("runMcpTool", () => {
  it("denies over-limit calls before executing private data work", async () => {
    const operation = vi.fn()
    const logEvent = vi.fn()
    const result = await runMcpTool(
      context({
        rateLimit: async () => ({
          allowed: false,
          limit: 20,
          remaining: 0,
          retryAfterSeconds: 17,
        }),
        logEvent,
      }),
      { tool: "search", scope: "transcripts:search", timeoutMs: 100 },
      operation
    )

    expect(operation).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
    expect(
      JSON.parse(
        result.content[0].type === "text" ? result.content[0].text : "{}"
      )
    ).toEqual({
      error: "rate_limited",
      message: "Try again in 17 seconds.",
    })
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        rateLimit: "denied",
        errorCategory: "rate_limited",
      })
    )
  })

  it("times out slow work with a private-safe stable error", async () => {
    vi.useFakeTimers()
    const resultPromise = runMcpTool(
      context(),
      { tool: "search", scope: "transcripts:search", timeoutMs: 50 },
      async () => new Promise(() => undefined)
    )

    await vi.advanceTimersByTimeAsync(51)
    const result = await resultPromise
    expect(result.isError).toBe(true)
    expect(
      result.content[0].type === "text" && result.content[0].text
    ).toContain("temporarily_unavailable")
  })

  it("challenges missing scopes before consuming a rate bucket", async () => {
    const rateLimit = vi.fn()
    const result = await runMcpTool(
      context({
        principal: { ...principal, scopes: new Set(["transcripts:read"]) },
        rateLimit,
      }),
      { tool: "search", scope: "transcripts:search", timeoutMs: 100 },
      vi.fn()
    )

    expect(rateLimit).not.toHaveBeenCalled()
    expect(result._meta?.["mcp/www_authenticate"]).toContain(
      'scope="transcripts:search"'
    )
  })
})
