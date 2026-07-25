import { describe, expect, it } from "vitest"
import { groupActiveOAuthConnections } from "./connection-groups"

describe("groupActiveOAuthConnections", () => {
  it("shows repeated grants for the same app as one connection", () => {
    const groups = groupActiveOAuthConnections([
      {
        id: "older",
        label: "Engram for macOS",
        clientId: "engram-macos",
        status: "active",
        scopes: ["recordings:read"],
        createdAt: "2026-07-23T10:00:00.000Z",
        lastUsedAt: "2026-07-23T11:00:00.000Z",
      },
      {
        id: "newer",
        label: "Engram for macOS",
        clientId: "engram-macos",
        status: "active",
        scopes: ["recordings:write"],
        createdAt: "2026-07-25T10:00:00.000Z",
        lastUsedAt: "2026-07-25T11:00:00.000Z",
      },
      {
        id: "revoked",
        label: "Engram for macOS",
        clientId: "engram-macos",
        status: "revoked",
        scopes: ["recordings:read"],
        createdAt: "2026-07-22T10:00:00.000Z",
        lastUsedAt: null,
      },
    ])

    expect(groups).toEqual([
      {
        key: "engram-macos",
        ids: ["older", "newer"],
        label: "Engram for macOS",
        clientId: "engram-macos",
        scopes: ["recordings:read", "recordings:write"],
        createdAt: "2026-07-25T10:00:00.000Z",
        lastUsedAt: "2026-07-25T11:00:00.000Z",
      },
    ])
  })
})
