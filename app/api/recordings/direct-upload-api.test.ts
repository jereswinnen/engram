import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  recording: null as Record<string, unknown> | null,
  inserts: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  head: vi.fn(),
  presignedPutUrl: vi.fn(),
  runTranscription: vi.fn(),
  runEnhancement: vi.fn(),
}))

vi.mock("@/db", () => ({
  db: {
    query: {
      recordings: {
        findFirst: vi.fn(async () =>
          state.recording?.ownerId === "user-1" ? state.recording : null
        ),
      },
    },
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            state.inserts.push(values)
            if (state.recording) return []
            state.recording = values
            return [values]
          },
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            state.updates.push(values)
            if (state.recording?.status !== "pending_upload") return []
            state.recording = { ...state.recording, ...values }
            return [{ id: state.recording.id }]
          },
        }),
      }),
    }),
  },
}))

vi.mock("@/lib/auth/connections", () => ({
  ensureActivePrincipalConnection: vi.fn(async () => true),
}))

vi.mock("@/lib/storage", () => ({
  buildAudioKey: (id: string) => `audio/${id}.m4a`,
  getStorage: () => ({
    head: state.head,
    presignedPutUrl: state.presignedPutUrl,
  }),
}))

vi.mock("@/lib/pipeline", () => ({
  runTranscription: state.runTranscription,
  runEnhancement: state.runEnhancement,
}))

import { POST as initiateUpload } from "./initiate/route"
import { POST as completeUpload } from "./[id]/complete/route"

const recordingID = "386f626f-7d01-4baa-9954-edce960031e6"

function initiateRequest(overrides: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/recordings/initiate", {
    method: "POST",
    headers: {
      authorization: "Bearer recorder-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      id: recordingID,
      title: "Weekly sync",
      durationSeconds: 947,
      startedAt: "2026-07-23T17:02:40.000Z",
      byteCount: 17_757_683,
      ...overrides,
    }),
  })
}

function completeRequest(byteCount = 17_757_683) {
  return {
    request: new Request(
      `http://localhost/api/recordings/${recordingID}/complete`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer recorder-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ byteCount }),
      }
    ),
    context: { params: Promise.resolve({ id: recordingID }) },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.recording = null
  state.inserts.length = 0
  state.updates.length = 0
  state.head.mockResolvedValue(null)
  state.presignedPutUrl.mockResolvedValue("https://r2.example/upload")
  state.runTranscription.mockResolvedValue(true)
  state.runEnhancement.mockResolvedValue(undefined)
  process.env.MAC_RECORDER_API_TOKEN = "recorder-secret"
  process.env.LEGACY_MAC_RECORDER_OWNER_ID = "user-1"
  process.env.AUTH_LEGACY_MAC_ENABLED = "true"
})

describe("POST /api/recordings/initiate", () => {
  it("creates an idempotent pending recording and returns a direct R2 upload", async () => {
    const response = await initiateUpload(initiateRequest())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      id: recordingID,
      url: `/recordings/${recordingID}`,
      completed: false,
      upload: {
        url: "https://r2.example/upload",
        headers: { "Content-Type": "audio/mp4" },
      },
    })
    expect(state.inserts).toEqual([
      expect.objectContaining({
        id: recordingID,
        source: "mac",
        title: "Weekly sync",
        originalTitle: "Weekly sync",
        titleOrigin: "device",
        ownerId: "user-1",
        createdByConnectionId: "00000000-0000-4000-8000-000000000001",
        storageKey: `audio/${recordingID}.m4a`,
        status: "pending_upload",
        durationSeconds: 947,
        createdAt: new Date("2026-07-23T17:02:40.000Z"),
      }),
    ])
    expect(state.presignedPutUrl).toHaveBeenCalledWith(
      `audio/${recordingID}.m4a`,
      "audio/mp4"
    )

    await initiateUpload(initiateRequest())
    expect(state.inserts).toHaveLength(1)
  })

  it("skips a second PUT when a prior attempt uploaded the complete object", async () => {
    state.recording = {
      id: recordingID,
      source: "mac",
      storageKey: `audio/${recordingID}.m4a`,
      status: "pending_upload",
      ownerId: "user-1",
      createdByConnectionId: "00000000-0000-4000-8000-000000000001",
    }
    state.head.mockResolvedValue({ size: 17_757_683 })

    const response = await initiateUpload(initiateRequest())

    expect(await response.json()).toMatchObject({
      completed: false,
      upload: null,
    })
    expect(state.presignedPutUrl).not.toHaveBeenCalled()
  })

  it("returns an already completed retry without touching storage", async () => {
    state.recording = {
      id: recordingID,
      source: "mac",
      storageKey: `audio/${recordingID}.m4a`,
      status: "transcribing",
      ownerId: "user-1",
      createdByConnectionId: "00000000-0000-4000-8000-000000000001",
    }

    const response = await initiateUpload(initiateRequest())

    expect(await response.json()).toMatchObject({
      id: recordingID,
      completed: true,
      upload: null,
    })
    expect(state.head).not.toHaveBeenCalled()
  })

  it("does not disclose or presign a UUID already owned by another user", async () => {
    state.recording = {
      id: recordingID,
      source: "mac",
      storageKey: `audio/${recordingID}.m4a`,
      status: "pending_upload",
      ownerId: "user-b",
      createdByConnectionId: "10000000-0000-4000-8000-000000000001",
    }

    const response = await initiateUpload(initiateRequest())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: "Recording ID is already in use",
    })
    expect(state.presignedPutUrl).not.toHaveBeenCalled()
    expect(state.head).not.toHaveBeenCalled()
  })

  it("requires the dedicated recorder token", async () => {
    delete process.env.MAC_RECORDER_API_TOKEN

    const response = await initiateUpload(initiateRequest())

    expect(response.status).toBe(401)
    expect(state.inserts).toHaveLength(0)
  })

  it("rejects invalid metadata before creating a recording", async () => {
    const response = await initiateUpload(
      initiateRequest({ byteCount: 0, id: "not-a-uuid" })
    )

    expect(response.status).toBe(400)
    expect(state.inserts).toHaveLength(0)
  })
})

describe("POST /api/recordings/[id]/complete", () => {
  beforeEach(() => {
    state.recording = {
      id: recordingID,
      source: "mac",
      storageKey: `audio/${recordingID}.m4a`,
      status: "pending_upload",
      ownerId: "user-1",
      createdByConnectionId: "00000000-0000-4000-8000-000000000001",
    }
    state.head.mockResolvedValue({ size: 17_757_683 })
  })

  it("verifies the object before transitioning and starts processing once", async () => {
    const first = completeRequest()
    const firstResponse = await completeUpload(first.request, first.context)
    const second = completeRequest()
    const secondResponse = await completeUpload(second.request, second.context)

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    expect(await firstResponse.json()).toEqual({
      id: recordingID,
      url: `/recordings/${recordingID}`,
    })
    expect(state.updates).toEqual([{ status: "uploaded", errorMessage: null }])
    expect(state.runTranscription).toHaveBeenCalledTimes(1)
    expect(state.runTranscription).toHaveBeenCalledWith("user-1", recordingID)
    await vi.waitFor(() =>
      expect(state.runEnhancement).toHaveBeenCalledWith("user-1", recordingID)
    )
  })

  it("does not start enhancement when transcription fails", async () => {
    state.runTranscription.mockResolvedValueOnce(false)
    const { request, context } = completeRequest()

    const response = await completeUpload(request, context)

    expect(response.status).toBe(200)
    await vi.waitFor(() =>
      expect(state.runTranscription).toHaveBeenCalledWith("user-1", recordingID)
    )
    expect(state.runEnhancement).not.toHaveBeenCalled()
  })

  it("rejects an incomplete object without starting processing", async () => {
    state.head.mockResolvedValue({ size: 10 })
    const { request, context } = completeRequest()

    const response = await completeUpload(request, context)

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: "Uploaded audio is incomplete. Retry the upload.",
    })
    expect(state.updates).toHaveLength(0)
    expect(state.runTranscription).not.toHaveBeenCalled()
  })

  it("returns 404 before storage access for another owner's recording", async () => {
    state.recording = {
      id: recordingID,
      source: "mac",
      storageKey: `audio/${recordingID}.m4a`,
      status: "pending_upload",
      ownerId: "user-b",
      createdByConnectionId: "10000000-0000-4000-8000-000000000001",
    }
    const { request, context } = completeRequest()

    const response = await completeUpload(request, context)

    expect(response.status).toBe(404)
    expect(state.head).not.toHaveBeenCalled()
    expect(state.updates).toHaveLength(0)
  })

  it("rejects completion when no uploaded object exists", async () => {
    state.head.mockResolvedValue(null)
    const { request, context } = completeRequest()

    const response = await completeUpload(request, context)

    expect(response.status).toBe(409)
    expect(state.updates).toHaveLength(0)
  })

  it("rejects an invalid recording ID before querying storage", async () => {
    const { request } = completeRequest()

    const response = await completeUpload(request, {
      params: Promise.resolve({ id: "not-a-uuid" }),
    })

    expect(response.status).toBe(400)
    expect(state.head).not.toHaveBeenCalled()
  })
})
