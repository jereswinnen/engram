import { describe, expect, it, vi } from "vitest"
import { verifyOAuthBearerToken } from "./oauth-resource"

const CONNECTION_ID = "10000000-0000-4000-8000-000000000001"

describe("verifyOAuthBearerToken", () => {
  it("maps a fully verified API JWT to an OAuth principal", async () => {
    const verifyJwt = vi.fn(async () => ({
      sub: "user-a",
      azp: "engram-macos",
      connection_id: CONNECTION_ID,
      scope: "recordings:write recordings:delete-own offline_access",
    }))
    const principal = await verifyOAuthBearerToken(
      new Request("https://engram.example/api/recordings/initiate"),
      "signed-token",
      { appUrl: "https://engram.example", verifyJwt }
    )

    expect(verifyJwt).toHaveBeenCalledWith("signed-token", {
      audience: "https://engram.example/api",
      issuer: "https://engram.example/api/auth",
    })
    expect(principal).toMatchObject({
      userId: "user-a",
      mechanism: "oauth",
      audience: "https://engram.example/api",
      clientId: "engram-macos",
      connectionId: CONNECTION_ID,
    })
  })

  it("requires the MCP audience for the MCP transport", async () => {
    const verifyJwt = vi.fn(async () => ({
      sub: "user-a",
      azp: "codex",
      connection_id: CONNECTION_ID,
      scope: "transcripts:search transcripts:read offline_access",
    }))
    await verifyOAuthBearerToken(
      new Request("https://engram.example/mcp"),
      "signed-token",
      { appUrl: "https://engram.example", verifyJwt }
    )
    expect(verifyJwt).toHaveBeenCalledWith(
      "signed-token",
      expect.objectContaining({ audience: "https://engram.example/mcp" })
    )
  })

  it("fails closed for missing identity claims and unknown scopes", async () => {
    const missingConnection = await verifyOAuthBearerToken(
      new Request("https://engram.example/api/recordings"),
      "signed-token",
      {
        appUrl: "https://engram.example",
        verifyJwt: async () => ({
          sub: "user-a",
          azp: "engram-macos",
          scope: "recordings:write",
        }),
      }
    )
    const unknownScope = await verifyOAuthBearerToken(
      new Request("https://engram.example/api/recordings"),
      "signed-token",
      {
        appUrl: "https://engram.example",
        verifyJwt: async () => ({
          sub: "user-a",
          azp: "engram-macos",
          connection_id: CONNECTION_ID,
          scope: "recordings:write admin:all",
        }),
      }
    )
    expect(missingConnection).toBeNull()
    expect(unknownScope).toBeNull()
  })

  it("fails closed when signature, issuer, audience, or time validation fails", async () => {
    const principal = await verifyOAuthBearerToken(
      new Request("https://engram.example/api/recordings"),
      "bad-token",
      {
        appUrl: "https://engram.example",
        verifyJwt: async () => {
          throw new Error("JWT verification failed")
        },
      }
    )
    expect(principal).toBeNull()
  })
})
