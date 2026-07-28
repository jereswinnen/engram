import { describe, expect, it, vi } from "vitest"

vi.mock("@/db", () => ({ db: {} }))

import { canReadRecordingMetadata } from "./store"

const recording = {
  ownerId: "user-1",
  createdByConnectionId: "legacy-connection",
  source: "mac",
}

const oauthPrincipal = {
  userId: "user-1",
  mechanism: "oauth" as const,
  scopes: new Set(["recordings:write"]),
  connectionId: "oauth-connection",
}

describe("canReadRecordingMetadata", () => {
  it("allows an OAuth connection to refresh legacy Mac metadata for its owner", () => {
    expect(canReadRecordingMetadata(recording, oauthPrincipal)).toBe(true)
  })

  it("does not expose another owner's recording", () => {
    expect(
      canReadRecordingMetadata(
        { ...recording, ownerId: "user-2" },
        oauthPrincipal
      )
    ).toBe(false)
  })

  it("does not broaden cross-connection metadata reads beyond Mac recordings", () => {
    expect(
      canReadRecordingMetadata(
        { ...recording, source: "plaud" },
        oauthPrincipal
      )
    ).toBe(false)
  })
})
