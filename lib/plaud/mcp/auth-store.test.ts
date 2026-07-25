import { beforeEach, describe, expect, it, vi } from "vitest"

const memory: {
  credential?: {
    id: string
    ownerId: string
    provider: string
    ciphertext: string
  }
  attempt?: Record<string, any>
} = {}

vi.mock("@/db", () => ({
  db: {
    query: {
      apiCredentials: { findFirst: async () => memory.credential },
      plaudOAuthAttempts: { findFirst: async () => memory.attempt },
    },
    insert: () => ({
      values: (values: any) => {
        if ("stateHash" in values) {
          memory.attempt = { id: "attempt-1", usedAt: null, ...values }
          return { returning: async () => [{ id: "attempt-1" }] }
        }
        memory.credential = { id: "credential-1", ...values }
        return Promise.resolve()
      },
    }),
    update: () => ({
      set: (values: any) => ({
        where: () => {
          if ("ciphertext" in values || "ownerId" in values) {
            Object.assign(memory.credential ?? {}, values)
            return Promise.resolve()
          }
          Object.assign(memory.attempt ?? {}, values)
          return {
            then: (resolve: (value: unknown) => void) => resolve(undefined),
            returning: async () =>
              values.usedAt ? [{ id: memory.attempt?.id }] : [],
          }
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        memory.credential = undefined
      },
    }),
  },
}))

beforeEach(() => {
  memory.credential = undefined
  memory.attempt = undefined
  process.env.ENCRYPTION_KEY = "0".repeat(64)
  process.env.NEXT_PUBLIC_APP_URL = "https://engram.example"
})

describe("owner-scoped Plaud auth storage", () => {
  it("keeps renewable credentials encrypted in the owner credential row", async () => {
    const { createPlaudAuthStore } = await import("./auth-store")
    const store = createPlaudAuthStore("user-a")

    await store.saveTokens({
      access_token: "secret-access-token",
      token_type: "bearer",
    } as any)
    await store.saveClientInfo({ client_id: "c1" } as any)

    expect(memory.credential).toMatchObject({
      ownerId: "user-a",
      provider: "plaud",
    })
    expect(memory.credential!.ciphertext).not.toContain("secret-access-token")
    expect((await store.getTokens())?.access_token).toBe("secret-access-token")
    expect((await store.getClientInfo())?.client_id).toBe("c1")
    expect(await store.isConnected()).toBe(true)

    await store.clear()
    expect(await store.isConnected()).toBe(false)
  })

  it("stores verifier and authorization URL in an expiring attempt, not credentials", async () => {
    const { createPlaudAuthStore, createPlaudOAuthAttempt } =
      await import("./auth-store")
    const { attemptId } = await createPlaudOAuthAttempt("user-a")
    const store = createPlaudAuthStore("user-a", attemptId)

    await store.saveCodeVerifier("verifier-123")
    await store.saveAuthorizationUrl("https://plaud.example/authorize?state=x")

    expect(memory.credential).toBeUndefined()
    expect(memory.attempt!.encryptedVerifier).not.toContain("verifier-123")
    expect(memory.attempt!.encryptedAuthorizationUrl).not.toContain("state=x")
    expect(await store.getCodeVerifier()).toBe("verifier-123")
    expect(await store.getAuthorizationUrl()).toContain("state=x")
  })
})
