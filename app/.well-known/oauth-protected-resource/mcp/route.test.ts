import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const getProtectedResourceMetadata = vi.hoisted(() => vi.fn())

vi.mock("@/auth", () => ({ auth: { id: "auth" } }))
vi.mock("@better-auth/oauth-provider/resource-client", () => ({
  oauthProviderResourceClient: () => ({
    getActions: () => ({ getProtectedResourceMetadata }),
  }),
}))

import { GET } from "./route"

beforeEach(() => {
  vi.stubEnv("MCP_ENABLED", "true")
  vi.stubEnv("AUTH_OAUTH_BEARER_ENABLED", "true")
  vi.stubEnv("BETTER_AUTH_URL", "https://engram.example/")
  getProtectedResourceMetadata.mockReset()
  getProtectedResourceMetadata.mockImplementation(async (input) => input)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("GET MCP protected-resource metadata", () => {
  it("is hidden while the MCP feature is disabled", async () => {
    vi.stubEnv("MCP_ENABLED", "false")

    const response = await GET()

    expect(response.status).toBe(404)
    expect(getProtectedResourceMetadata).not.toHaveBeenCalled()
  })

  it("is hidden while OAuth bearer support is disabled", async () => {
    vi.stubEnv("AUTH_OAUTH_BEARER_ENABLED", "false")

    const response = await GET()

    expect(response.status).toBe(404)
    expect(getProtectedResourceMetadata).not.toHaveBeenCalled()
  })

  it("publishes the MCP audience, scopes, and header bearer method", async () => {
    const response = await GET()

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300")
    expect(getProtectedResourceMetadata).toHaveBeenCalledWith({
      resource: "https://engram.example/mcp",
      authorization_servers: ["https://engram.example/api/auth"],
      scopes_supported: [
        "transcripts:search",
        "transcripts:read",
        "offline_access",
      ],
      bearer_methods_supported: ["header"],
    })
    expect(await response.json()).toMatchObject({
      resource: "https://engram.example/mcp",
    })
  })
})
