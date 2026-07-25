import { describe, expect, it } from "vitest"
import { forbiddenResponse, unauthorizedResponse } from "./policy"

describe("OAuth bearer challenges", () => {
  const policy = {
    scopes: ["recordings:write"],
    resourceMetadataUrl:
      "https://engram.example/.well-known/oauth-protected-resource/api",
  }

  it("returns a resource metadata challenge for invalid tokens", () => {
    const response = unauthorizedResponse(policy)
    expect(response.status).toBe(401)
    expect(response.headers.get("WWW-Authenticate")).toContain(
      'resource_metadata="https://engram.example/.well-known/oauth-protected-resource/api"'
    )
    expect(response.headers.get("WWW-Authenticate")).toContain(
      'error="invalid_token"'
    )
  })

  it("returns the required scope for insufficient authorization", () => {
    const response = forbiddenResponse(policy)
    expect(response.status).toBe(403)
    expect(response.headers.get("WWW-Authenticate")).toContain(
      'error="insufficient_scope"'
    )
    expect(response.headers.get("WWW-Authenticate")).toContain(
      'scope="recordings:write"'
    )
  })
})
