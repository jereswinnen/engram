import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  deleteObject: vi.fn(),
  deleteWhere: vi.fn(),
  findRecording: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock("@/auth", () => ({
  auth: { api: { getSession: mocks.getSession } },
}))

vi.mock("@/db", () => ({
  db: {
    query: { recordings: { findFirst: mocks.findRecording } },
    delete: vi.fn(() => ({ where: mocks.deleteWhere })),
  },
}))

vi.mock("@/lib/storage", () => ({
  getStorage: () => ({ delete: mocks.deleteObject }),
}))

import { DELETE } from "./route"

function request(id = "recording-1") {
  return {
    request: new NextRequest(`http://localhost/api/recordings/${id}`, {
      method: "DELETE",
    }),
    context: { params: Promise.resolve({ id }) },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({ user: { id: "user-1" } })
  mocks.findRecording.mockResolvedValue({
    id: "recording-1",
    storageKey: "audio/recording-1.m4a",
  })
  mocks.deleteObject.mockResolvedValue(undefined)
  mocks.deleteWhere.mockResolvedValue(undefined)
})

describe("DELETE /api/recordings/[id]", () => {
  it("requires an authenticated browser session", async () => {
    mocks.getSession.mockResolvedValue(null)
    const { request: req, context } = request()

    const response = await DELETE(req, context)

    expect(response.status).toBe(401)
    expect(mocks.findRecording).not.toHaveBeenCalled()
  })

  it("returns 404 without deleting storage for a missing recording", async () => {
    mocks.findRecording.mockResolvedValue(null)
    const { request: req, context } = request("missing")

    const response = await DELETE(req, context)

    expect(response.status).toBe(404)
    expect(mocks.deleteObject).not.toHaveBeenCalled()
  })

  it("deletes the R2 object before the cascading database row", async () => {
    const calls: string[] = []
    mocks.deleteObject.mockImplementation(async () => {
      calls.push("storage")
    })
    mocks.deleteWhere.mockImplementation(async () => {
      calls.push("database")
    })
    const { request: req, context } = request()

    const response = await DELETE(req, context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(mocks.deleteObject).toHaveBeenCalledWith("audio/recording-1.m4a")
    expect(calls).toEqual(["storage", "database"])
  })

  it("preserves the database row when storage deletion fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.deleteObject.mockRejectedValue(new Error("R2 unavailable"))
    const { request: req, context } = request()

    const response = await DELETE(req, context)

    expect(response.status).toBe(500)
    expect(mocks.deleteWhere).not.toHaveBeenCalled()
  })
})
