import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
  status: "active" as "active" | "revoked" | null,
}))

vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoNothing: async () => {
          mocks.inserted.push(values)
        },
      }),
    }),
    query: {
      authConnections: {
        findFirst: async () =>
          mocks.status === null ? null : { status: mocks.status },
      },
    },
  },
}))

beforeEach(() => {
  mocks.inserted.length = 0
  mocks.status = "active"
})

describe("ensureActivePrincipalConnection", () => {
  it("lazily provisions the synthetic legacy connection", async () => {
    const { ensureActivePrincipalConnection } = await import("./connections")
    const active = await ensureActivePrincipalConnection({
      userId: "user-a",
      mechanism: "legacy-mac",
      scopes: new Set(["recordings:write"]),
      clientId: "engram-macos-legacy",
      grantId: "00000000-0000-4000-8000-000000000001",
      connectionId: "00000000-0000-4000-8000-000000000001",
    })

    expect(active).toBe(true)
    expect(mocks.inserted).toEqual([
      expect.objectContaining({
        id: "00000000-0000-4000-8000-000000000001",
        ownerId: "user-a",
        mechanism: "legacy-mac",
      }),
    ])
  })

  it("rejects a revoked connection", async () => {
    mocks.status = "revoked"
    const { ensureActivePrincipalConnection } = await import("./connections")

    expect(
      await ensureActivePrincipalConnection({
        userId: "user-a",
        mechanism: "oauth",
        scopes: new Set(["recordings:write"]),
        connectionId: "10000000-0000-4000-8000-000000000001",
      })
    ).toBe(false)
    expect(mocks.inserted).toHaveLength(0)
  })
})
