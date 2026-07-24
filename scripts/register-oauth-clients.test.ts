import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  existing: null as { id: string; clientSecret: string | null } | null,
  inserted: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
}))

vi.mock("@/db", () => {
  const tx = {
    query: {
      oauthClient: {
        findFirst: vi.fn(async () => state.existing),
      },
    },
    insert: vi.fn(() => ({
      values: vi.fn(async (value: Record<string, unknown>) => {
        state.inserted.push(value)
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((value: Record<string, unknown>) => ({
        where: vi.fn(async () => {
          state.updated.push(value)
        }),
      })),
    })),
  }
  return {
    db: {
      transaction: vi.fn(async (callback: (value: typeof tx) => unknown) =>
        callback(tx)
      ),
    },
  }
})

import {
  MAC_CLIENT_REGISTRATION,
  provisionOAuthClients,
} from "./register-oauth-clients"

describe("Mac OAuth client provisioning", () => {
  beforeEach(() => {
    state.existing = null
    state.inserted = []
    state.updated = []
  })

  it("creates the fixed public PKCE client without a secret", async () => {
    await expect(provisionOAuthClients()).resolves.toBe("created")
    expect(state.inserted).toHaveLength(1)
    expect(state.inserted[0]).toMatchObject({
      ...MAC_CLIENT_REGISTRATION,
      clientId: "engram-macos",
      tokenEndpointAuthMethod: "none",
      public: true,
      requirePKCE: true,
    })
    expect(state.inserted[0]).not.toHaveProperty("clientSecret")
  })

  it("updates the same row on repeat and refuses a confidential collision", async () => {
    state.existing = { id: "stable-row-id", clientSecret: null }
    await expect(provisionOAuthClients()).resolves.toBe("updated")
    await expect(provisionOAuthClients()).resolves.toBe("updated")
    expect(state.inserted).toHaveLength(0)
    expect(state.updated).toHaveLength(2)

    state.existing = { id: "stable-row-id", clientSecret: "secret" }
    await expect(provisionOAuthClients()).rejects.toThrow(
      "refusing to replace it"
    )
  })
})
