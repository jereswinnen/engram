import { describe, expect, it } from "vitest"
import {
  ENGRAM_MAC_CLIENT_ID,
  ENGRAM_MAC_REDIRECT_URI,
  ENGRAM_MAC_SCOPES,
  ENGRAM_MCP_SCOPES,
  oauthUrls,
} from "./oauth-config"

describe("Engram OAuth contract", () => {
  it("keeps native client identifiers and audiences stable", () => {
    const urls = oauthUrls("https://engram.example/")

    expect(ENGRAM_MAC_CLIENT_ID).toBe("engram-macos")
    expect(ENGRAM_MAC_REDIRECT_URI).toBe(
      "jeremys.engram.recorder://oauth/callback"
    )
    expect(urls.issuer).toBe("https://engram.example/api/auth")
    expect(urls.apiResource).toBe("https://engram.example/api")
    expect(urls.mcpResource).toBe("https://engram.example/mcp")
  })

  it("does not grant MCP the Mac write scopes", () => {
    expect(ENGRAM_MCP_SCOPES).not.toContain("recordings:write")
    expect(ENGRAM_MCP_SCOPES).not.toContain("recordings:delete-own")
    expect(ENGRAM_MAC_SCOPES).not.toContain("transcripts:read")
  })
})
