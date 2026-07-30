import { describe, expect, it, vi } from "vitest"
import type { AuthPrincipal } from "@/lib/auth/principal"
import { requireMcpPrincipal } from "./auth"

const APP_URL = "https://engram.example"
const OAUTH_PRINCIPAL: AuthPrincipal = {
  userId: "user-a",
  mechanism: "oauth",
  audience: `${APP_URL}/mcp`,
  scopes: new Set(["transcripts:read"]),
}

describe("requireMcpPrincipal", () => {
  it("rejects cookie-only requests without attempting session auth", async () => {
    const authenticate = vi.fn()
    const response = await requireMcpPrincipal(
      new Request(`${APP_URL}/mcp`, {
        headers: { cookie: "better-auth.session_token=browser-session" },
      }),
      { appUrl: APP_URL, requirePrincipal: authenticate }
    )

    expect(response).toBeInstanceOf(Response)
    expect((response as Response).status).toBe(401)
    expect((response as Response).headers.get("WWW-Authenticate")).toContain(
      `resource_metadata="${APP_URL}/.well-known/oauth-protected-resource/mcp"`
    )
    expect(authenticate).not.toHaveBeenCalled()
  })

  it("rejects malformed bearer headers without falling back", async () => {
    const authenticate = vi.fn()
    const response = await requireMcpPrincipal(
      new Request(`${APP_URL}/mcp`, {
        headers: { authorization: "Bearer " },
      }),
      { appUrl: APP_URL, requirePrincipal: authenticate }
    )

    expect((response as Response).status).toBe(401)
    expect(authenticate).not.toHaveBeenCalled()
  })

  it("rejects bearer credentials in query parameters", async () => {
    const authenticate = vi.fn()
    const response = await requireMcpPrincipal(
      new Request(`${APP_URL}/mcp?access_token=secret`, {
        headers: { authorization: "Bearer header-token" },
      }),
      { appUrl: APP_URL, requirePrincipal: authenticate }
    )

    expect((response as Response).status).toBe(400)
    expect(authenticate).not.toHaveBeenCalled()
  })

  it("delegates valid bearer requests to OAuth-only audience checks", async () => {
    const authenticate = vi.fn(async () => OAUTH_PRINCIPAL)
    const request = new Request(`${APP_URL}/mcp`, {
      headers: { authorization: "Bearer signed-token" },
    })
    const principal = await requireMcpPrincipal(request, {
      appUrl: APP_URL,
      requirePrincipal: authenticate,
    })

    expect(principal).toBe(OAUTH_PRINCIPAL)
    expect(authenticate).toHaveBeenCalledWith(request, {
      audience: `${APP_URL}/mcp`,
      mechanisms: ["oauth"],
      resourceMetadataUrl: `${APP_URL}/.well-known/oauth-protected-resource/mcp`,
    })
  })
})
