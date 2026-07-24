import { describe, it, expect, vi, beforeEach } from "vitest"

const syncPlaud = vi.hoisted(() => vi.fn())

vi.mock("@/auth", () => ({ auth: { api: { getSession: vi.fn() } } }))
vi.mock("@/lib/plaud/sync", () => ({
  syncPlaud,
}))

beforeEach(async () => {
  const { auth } = await import("@/auth")
  vi.mocked(auth.api.getSession).mockReset()
  syncPlaud.mockReset()
  syncPlaud.mockResolvedValue({
    ranAt: "x",
    newCount: 0,
    skippedCount: 0,
    failedCount: 0,
  })
  delete process.env.MAC_RECORDER_API_TOKEN
  delete process.env.LEGACY_MAC_RECORDER_OWNER_ID
})

function req(headers: Record<string, string>) {
  return new Request("http://localhost/api/sync", { method: "POST", headers })
}

describe("POST /api/sync", () => {
  it("rejects requests without a browser session", async () => {
    const { auth } = await import("@/auth")
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null)
    const { POST } = await import("./route")
    expect((await POST(req({}) as never)).status).toBe(401)
    expect(syncPlaud).not.toHaveBeenCalled()
  })

  it("accepts a valid browser session", async () => {
    const { auth } = await import("@/auth")
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      user: { id: "u1" },
    } as never)
    const { POST } = await import("./route")
    expect((await POST(req({}) as never)).status).toBe(200)
    expect(syncPlaud).toHaveBeenCalledWith("u1")
  })

  it("does not accept the retired cron bearer credential", async () => {
    const { auth } = await import("@/auth")
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null)
    const { POST } = await import("./route")
    expect(
      (
        await POST(
          req({ authorization: "Bearer old-cron-secret" }) as never
        )
      ).status
    ).toBe(401)
    expect(auth.api.getSession).not.toHaveBeenCalled()
    expect(syncPlaud).not.toHaveBeenCalled()
  })
})
