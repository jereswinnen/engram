import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  deleteObject: vi.fn(),
  deleteWhere: vi.fn(),
  findRecording: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock("@/auth", () => ({
  auth: { api: { getSession: mocks.getSession } },
}))

vi.mock("@/lib/auth/connections", () => ({
  ensureActivePrincipalConnection: vi.fn(async () => true),
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

function request(id = "recording-1", headers: Record<string, string> = {}) {
  return {
    request: new NextRequest(`http://localhost/api/recordings/${id}`, {
      method: "DELETE",
      headers,
    }),
    context: { params: Promise.resolve({ id }) },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.MAC_RECORDER_API_TOKEN = "recorder-secret"
  process.env.LEGACY_MAC_RECORDER_OWNER_ID = "user-1"
  process.env.AUTH_LEGACY_MAC_ENABLED = "true"
  mocks.getSession.mockResolvedValue({ user: { id: "user-1" } })
  mocks.findRecording.mockResolvedValue({
    id: "recording-1",
    source: "mac",
    ownerId: "user-1",
    createdByConnectionId: "00000000-0000-4000-8000-000000000001",
    storageKey: "audio/recording-1.m4a",
  })
  mocks.deleteObject.mockResolvedValue(undefined)
  mocks.deleteWhere.mockResolvedValue(undefined)
})

afterEach(() => {
  delete process.env.MAC_RECORDER_API_TOKEN
  delete process.env.LEGACY_MAC_RECORDER_OWNER_ID
  delete process.env.AUTH_LEGACY_MAC_ENABLED
})

describe("DELETE /api/recordings/[id]", () => {
  it("requires a browser session or recorder token", async () => {
    mocks.getSession.mockResolvedValue(null)
    const { request: req, context } = request()

    const response = await DELETE(req, context)

    expect(response.status).toBe(401)
    expect(mocks.findRecording).not.toHaveBeenCalled()
  })

  it("allows the recorder token to delete a Mac recording", async () => {
    mocks.getSession.mockResolvedValue(null)
    const { request: req, context } = request("recording-1", {
      authorization: "Bearer recorder-secret",
    })

    const response = await DELETE(req, context)

    expect(response.status).toBe(200)
    expect(mocks.deleteObject).toHaveBeenCalledWith("audio/recording-1.m4a")
  })

  it("does not allow the recorder token to delete a non-Mac recording", async () => {
    mocks.getSession.mockResolvedValue(null)
    mocks.findRecording.mockResolvedValue({
      id: "recording-1",
      source: "upload",
      ownerId: "user-1",
      createdByConnectionId: null,
      storageKey: "audio/recording-1.m4a",
    })
    const { request: req, context } = request("recording-1", {
      authorization: "Bearer recorder-secret",
    })

    const response = await DELETE(req, context)

    expect(response.status).toBe(404)
    expect(mocks.deleteObject).not.toHaveBeenCalled()
    expect(mocks.deleteWhere).not.toHaveBeenCalled()
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
