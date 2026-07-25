import { describe, expect, it } from "vitest"
import {
  ENGRAM_MAC_CLIENT_ID,
  ENGRAM_MAC_SCOPES,
  ENGRAM_MCP_SCOPES,
  oauthGrantMatchesClient,
} from "./oauth-config"

const APP_URL = "https://engram.example"

describe("OAuth client resource binding", () => {
  it("allows the Mac client only on the REST audience and Mac scopes", () => {
    expect(
      oauthGrantMatchesClient({
        appUrl: APP_URL,
        clientId: ENGRAM_MAC_CLIENT_ID,
        resource: `${APP_URL}/api`,
        scopes: ENGRAM_MAC_SCOPES,
      })
    ).toBe(true)
    expect(
      oauthGrantMatchesClient({
        appUrl: APP_URL,
        clientId: ENGRAM_MAC_CLIENT_ID,
        resource: `${APP_URL}/mcp`,
        scopes: ENGRAM_MAC_SCOPES,
      })
    ).toBe(false)
  })

  it("allows dynamic clients only on MCP with read-only MCP scopes", () => {
    expect(
      oauthGrantMatchesClient({
        appUrl: APP_URL,
        clientId: "dynamic-codex-client",
        resource: `${APP_URL}/mcp`,
        scopes: ENGRAM_MCP_SCOPES,
      })
    ).toBe(true)
    expect(
      oauthGrantMatchesClient({
        appUrl: APP_URL,
        clientId: "dynamic-codex-client",
        resource: `${APP_URL}/api`,
        scopes: ENGRAM_MCP_SCOPES,
      })
    ).toBe(false)
    expect(
      oauthGrantMatchesClient({
        appUrl: APP_URL,
        clientId: "dynamic-codex-client",
        resource: `${APP_URL}/mcp`,
        scopes: ["recordings:write"],
      })
    ).toBe(false)
  })
})
