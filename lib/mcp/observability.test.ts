import { describe, expect, it } from "vitest"
import type { AuthPrincipal } from "@/lib/auth/principal"
import { buildMcpToolEvent } from "./observability"

const principal: AuthPrincipal = {
  userId: "private-user-id",
  mechanism: "oauth",
  scopes: new Set(["transcripts:search"]),
  clientId: "private-client-id",
  connectionId: "private-connection-id",
}

describe("MCP observability", () => {
  it("logs bounded metrics and hashes, never result content or raw identities", () => {
    const result = {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            results: [{ id: "r1", snippet: "private roadmap phrase" }],
          }),
        },
      ],
    }
    const event = buildMcpToolEvent({
      requestId: "request-1",
      tool: "search",
      startedAt: 10,
      finishedAt: 22.4,
      result,
      userId: principal.userId,
      clientId: principal.clientId,
      connectionId: principal.connectionId,
      rateLimit: "allowed",
    })
    const serialized = JSON.stringify(event)

    expect(event).toMatchObject({
      event: "mcp_tool_call",
      requestId: "request-1",
      tool: "search",
      durationMs: 12,
      outcome: "success",
      resultCount: 1,
      rateLimit: "allowed",
    })
    expect(event.resultBytes).toBeGreaterThan(0)
    expect(event.userHash).toMatch(/^[a-f0-9]{16}$/)
    expect(serialized).not.toContain("private roadmap phrase")
    expect(serialized).not.toContain("private-user-id")
    expect(serialized).not.toContain("private-client-id")
    expect(serialized).not.toContain("private-connection-id")
  })
})
