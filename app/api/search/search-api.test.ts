import { beforeEach, describe, expect, it, vi } from "vitest"

const requirePrincipal = vi.hoisted(() => vi.fn())
const searchRecordings = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/policy", () => ({
  requirePrincipal,
  isAuthFailure: (value: unknown) => value instanceof Response,
}))
vi.mock("@/lib/search/search", () => ({ searchRecordings }))

beforeEach(() => {
  requirePrincipal.mockReset()
  searchRecordings.mockReset()
  requirePrincipal.mockResolvedValue({ userId: "user-a" })
  searchRecordings.mockResolvedValue({
    results: [],
    pagination: { limit: 20, offset: 0, hasMore: false },
  })
})

describe("GET /api/search", () => {
  it("requires transcript search scope and searches only for the principal", async () => {
    const { GET } = await import("./route")
    const response = await GET(
      new Request("http://localhost/api/search?q=mobile%20roadmap")
    )

    expect(response.status).toBe(200)
    expect(requirePrincipal).toHaveBeenCalledWith(expect.any(Request), {
      scopes: ["transcripts:search"],
    })
    expect(searchRecordings).toHaveBeenCalledWith("user-a", "mobile roadmap", {
      limit: 20,
      offset: 0,
    })
    expect(await response.json()).toMatchObject({
      version: "2026-07-25",
      query: "mobile roadmap",
      pagination: { limit: 20, offset: 0, hasMore: false },
    })
  })

  it("rejects a missing query", async () => {
    const { GET } = await import("./route")
    const response = await GET(new Request("http://localhost/api/search"))

    expect(response.status).toBe(400)
    expect(searchRecordings).not.toHaveBeenCalled()
  })

  it("returns authentication failures without searching", async () => {
    requirePrincipal.mockResolvedValueOnce(
      Response.json({ error: "unauthorized" }, { status: 401 })
    )
    const { GET } = await import("./route")
    const response = await GET(
      new Request("http://localhost/api/search?q=anything")
    )

    expect(response.status).toBe(401)
    expect(searchRecordings).not.toHaveBeenCalled()
  })

  it("validates stable pagination parameters", async () => {
    const { GET } = await import("./route")
    const response = await GET(
      new Request("http://localhost/api/search?q=anything&limit=51&offset=-1")
    )

    expect(response.status).toBe(400)
    expect(searchRecordings).not.toHaveBeenCalled()
  })
})
