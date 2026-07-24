import { describe, expect, it, vi } from "vitest"
import { authenticateRequest, LEGACY_MAC_CONNECTION_ID } from "./principal"

describe("authenticateRequest", () => {
  it("maps a browser session to an owner principal", async () => {
    const getSession = vi.fn(async () => ({ user: { id: "user-a" } }))
    const principal = await authenticateRequest(
      new Request("https://engram.example/api/recordings"),
      { getSession }
    )

    expect(principal).toMatchObject({ userId: "user-a", mechanism: "session" })
    expect(principal?.scopes.has("recordings:read")).toBe(true)
  })

  it("never falls back to a cookie when Authorization is invalid", async () => {
    const getSession = vi.fn(async () => ({ user: { id: "user-a" } }))
    const principal = await authenticateRequest(
      new Request("https://engram.example/api/recordings", {
        headers: { authorization: "Bearer wrong" },
      }),
      {
        env: {
          AUTH_LEGACY_MAC_ENABLED: "true",
          MAC_RECORDER_API_TOKEN: "right",
          LEGACY_MAC_RECORDER_OWNER_ID: "user-a",
        },
        getSession,
      }
    )

    expect(principal).toBeNull()
    expect(getSession).not.toHaveBeenCalled()
  })

  it("maps the temporary token to one explicit owner and connection", async () => {
    const principal = await authenticateRequest(
      new Request("https://engram.example/api/recordings", {
        headers: { authorization: "Bearer recorder-secret" },
      }),
      {
        env: {
          AUTH_LEGACY_MAC_ENABLED: "true",
          MAC_RECORDER_API_TOKEN: "recorder-secret",
          LEGACY_MAC_RECORDER_OWNER_ID: "user-a",
        },
      }
    )

    expect(principal).toMatchObject({
      userId: "user-a",
      mechanism: "legacy-mac",
      connectionId: LEGACY_MAC_CONNECTION_ID,
    })
    expect(principal?.scopes).toEqual(
      new Set(["recordings:write", "recordings:delete-own"])
    )
  })

  it("fails closed when the legacy owner is not configured", async () => {
    const principal = await authenticateRequest(
      new Request("https://engram.example/api/recordings", {
        headers: { authorization: "Bearer recorder-secret" },
      }),
      { env: { MAC_RECORDER_API_TOKEN: "recorder-secret" } }
    )
    expect(principal).toBeNull()
  })
})
