import { describe, expect, it, vi } from "vitest"
import type { AuthPrincipal } from "@/lib/auth/principal"

vi.mock("@/lib/search/documents", () => ({
  searchEngramDocuments: vi.fn(),
  recordingUrl: (appUrl: string, id: string) => `${appUrl}/recordings/${id}`,
}))
vi.mock("@/lib/recordings/documents", () => ({
  getOwnedTranscriptDocument: vi.fn(),
  getOwnedTranscriptPage: vi.fn(),
  getOwnedSummary: vi.fn(),
  encodeTranscriptCursor: vi.fn(() => "cursor"),
}))
vi.mock("@/db", () => ({ db: { execute: vi.fn() } }))

import { MCP_MAX_REQUEST_BYTES } from "./limits"
import { handleMcpHttpRequest } from "./transport"

const PRINCIPAL: AuthPrincipal = {
  userId: "user-a",
  mechanism: "oauth",
  audience: "https://engram.example/mcp",
  scopes: new Set(["transcripts:search", "transcripts:read"]),
}

function post(headers: Record<string, string> = {}) {
  return new Request("https://engram.example/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-03-26",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  })
}

describe("MCP HTTP transport", () => {
  it("returns 404 before authentication while disabled", async () => {
    const authenticate = vi.fn()
    const response = await handleMcpHttpRequest(post(), {
      env: { MCP_ENABLED: "false" },
      authenticate,
    })

    expect(response.status).toBe(404)
    expect(authenticate).not.toHaveBeenCalled()
  })

  it("returns authentication failures directly", async () => {
    const response = await handleMcpHttpRequest(post(), {
      env: { MCP_ENABLED: "true" },
      authenticate: async () =>
        Response.json({ error: "unauthorized" }, { status: 401 }),
    })
    expect(response.status).toBe(401)
  })

  it("rejects declared oversized requests before protocol handling", async () => {
    const response = await handleMcpHttpRequest(
      post({ "content-length": String(MCP_MAX_REQUEST_BYTES + 1) }),
      {
        env: { MCP_ENABLED: "true" },
        authenticate: async () => PRINCIPAL,
      }
    )
    expect(response.status).toBe(413)
  })

  it("enforces the request cap when Content-Length is absent", async () => {
    const request = new Request("https://engram.example/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "x".repeat(MCP_MAX_REQUEST_BYTES + 1),
    })
    expect(request.headers.get("content-length")).toBeNull()

    const response = await handleMcpHttpRequest(request, {
      env: { MCP_ENABLED: "true" },
      authenticate: async () => PRINCIPAL,
    })
    expect(response.status).toBe(413)
  })

  it("handles an authenticated stateless JSON protocol request", async () => {
    const response = await handleMcpHttpRequest(post(), {
      env: {
        MCP_ENABLED: "true",
        BETTER_AUTH_URL: "https://engram.example",
      },
      authenticate: async () => PRINCIPAL,
    })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.result.tools).toHaveLength(4)
    expect(response.headers.get("mcp-session-id")).toBeNull()
  })

  it("rejects stateful stream methods after authenticating", async () => {
    const authenticate = vi.fn(async () => PRINCIPAL)
    const response = await handleMcpHttpRequest(
      new Request("https://engram.example/mcp", { method: "GET" }),
      {
        env: { MCP_ENABLED: "true" },
        authenticate,
      }
    )
    expect(response.status).toBe(405)
    expect(authenticate).toHaveBeenCalledOnce()
  })
})
