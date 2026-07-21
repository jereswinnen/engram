import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/auth", () => ({ auth: { api: { getSession: vi.fn() } } }))
vi.mock("@/lib/plaud/sync", () => ({
  syncPlaud: vi.fn(async () => ({
    ranAt: "x",
    newCount: 0,
    skippedCount: 0,
    failedCount: 0,
  })),
}))

beforeEach(async () => {
  const { auth } = await import("@/auth")
  vi.mocked(auth.api.getSession).mockReset()
})

function req(headers: Record<string, string>) {
  return new Request("http://localhost/api/sync", { method: "POST", headers })
}

describe("isAuthorized", () => {
  it("rejects requests without a browser session", async () => {
    const { auth } = await import("@/auth")
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null)
    const { isAuthorized } = await import("./route")
    expect(await isAuthorized(req({}))).toBe(false)
  })

  it("accepts a valid browser session", async () => {
    const { auth } = await import("@/auth")
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      user: { id: "u1" },
    } as never)
    const { isAuthorized } = await import("./route")
    expect(await isAuthorized(req({}))).toBe(true)
  })

  it("does not accept the retired cron bearer credential", async () => {
    const { auth } = await import("@/auth")
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null)
    const { isAuthorized } = await import("./route")
    expect(
      await isAuthorized(req({ authorization: "Bearer old-cron-secret" }))
    ).toBe(false)
  })
})
