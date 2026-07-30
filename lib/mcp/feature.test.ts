import { describe, expect, it } from "vitest"
import { mcpEnabled, mcpUnavailableResponse } from "./feature"

describe("MCP feature gate", () => {
  it("is enabled only by the explicit true value", () => {
    expect(mcpEnabled({ MCP_ENABLED: "true" })).toBe(true)
    expect(mcpEnabled({ MCP_ENABLED: "false" })).toBe(false)
    expect(mcpEnabled({})).toBe(false)
  })

  it("fails closed as an undiscoverable route", async () => {
    const response = mcpUnavailableResponse()
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "not_found" })
  })
})
