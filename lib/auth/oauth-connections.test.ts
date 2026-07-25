import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
}))

vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: async (values: Record<string, unknown>) => {
        mocks.inserted.push(values)
      },
    }),
  },
}))

beforeEach(() => {
  mocks.inserted.length = 0
})

describe("createPendingOAuthConnection", () => {
  it("reuses the reference when the provider asks twice in one request", async () => {
    const { createPendingOAuthConnection } = await import("./oauth-connections")
    const input = {
      user: { id: "user-a" },
      session: { id: "session-a" },
      scopes: ["recordings:read", "transcripts:read"],
    }

    const first = await createPendingOAuthConnection(input)
    const second = await createPendingOAuthConnection({
      ...input,
      scopes: [...input.scopes].reverse(),
    })

    expect(second).toBe(first)
    expect(mocks.inserted).toEqual([
      expect.objectContaining({
        id: first,
        ownerId: "user-a",
        status: "pending",
      }),
    ])
  })
})
