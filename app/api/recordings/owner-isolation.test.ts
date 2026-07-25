import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getOwnedRecording: vi.fn(),
  getOwnedRecordingBundle: vi.fn(),
  runTranscription: vi.fn(),
  runEnhancement: vi.fn(),
  presignedGetUrl: vi.fn(),
  deleteObject: vi.fn(),
  setRecordingSpeaker: vi.fn(),
}))

vi.mock("@/lib/auth/policy", () => ({
  requirePrincipal: vi.fn(async () => ({
    userId: "user-b",
    mechanism: "session",
    scopes: new Set([
      "recordings:read",
      "recordings:write",
      "recordings:delete-own",
      "transcripts:read",
    ]),
  })),
  isAuthFailure: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/recordings/store", () => ({
  getOwnedRecording: mocks.getOwnedRecording,
  getOwnedRecordingBundle: mocks.getOwnedRecordingBundle,
  ownedRecordingWhere: vi.fn(),
  recordingBelongsToConnection: vi.fn(() => false),
}))

vi.mock("@/lib/pipeline", () => ({
  runTranscription: mocks.runTranscription,
  runEnhancement: mocks.runEnhancement,
}))

vi.mock("@/lib/storage", () => ({
  getStorage: () => ({
    presignedGetUrl: mocks.presignedGetUrl,
    delete: mocks.deleteObject,
  }),
}))

vi.mock("@/lib/speakers/store", () => ({
  getRecordingSpeakerMap: vi.fn(async () => ({})),
  setRecordingSpeaker: mocks.setRecordingSpeaker,
}))

vi.mock("@/db", () => ({
  db: { delete: vi.fn(() => ({ where: vi.fn() })) },
}))

import { GET as getAudio } from "./[id]/audio/route"
import { GET as exportRecording } from "./[id]/export/route"
import { POST as transcribe } from "./[id]/transcribe/route"
import { POST as enhance } from "./[id]/enhance/route"
import { POST as regenerate } from "./[id]/regenerate/route"
import { PUT as setSpeaker } from "./[id]/speakers/route"
import { DELETE as deleteRecording } from "./[id]/route"

const context = { params: Promise.resolve({ id: "owned-by-user-a" }) }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getOwnedRecording.mockResolvedValue(null)
  mocks.getOwnedRecordingBundle.mockResolvedValue(null)
  mocks.setRecordingSpeaker.mockResolvedValue(false)
})

describe("recording owner isolation", () => {
  it.each([
    [
      "audio",
      () =>
        getAudio(
          new NextRequest("https://engram.example/api/recordings/a/audio"),
          context
        ),
    ],
    [
      "export",
      () =>
        exportRecording(
          new NextRequest(
            "https://engram.example/api/recordings/a/export?format=json"
          ),
          context
        ),
    ],
    [
      "transcribe",
      () =>
        transcribe(
          new NextRequest(
            "https://engram.example/api/recordings/a/transcribe",
            {
              method: "POST",
            }
          ),
          context
        ),
    ],
    [
      "enhance",
      () =>
        enhance(
          new NextRequest("https://engram.example/api/recordings/a/enhance", {
            method: "POST",
          }),
          context
        ),
    ],
    [
      "regenerate",
      () =>
        regenerate(
          new NextRequest(
            "https://engram.example/api/recordings/a/regenerate",
            {
              method: "POST",
            }
          ),
          context
        ),
    ],
    [
      "speaker mapping",
      () =>
        setSpeaker(
          new NextRequest("https://engram.example/api/recordings/a/speakers", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ label: "Speaker 1", name: "Alice" }),
          }),
          context
        ),
    ],
    [
      "delete",
      () =>
        deleteRecording(
          new NextRequest("https://engram.example/api/recordings/a", {
            method: "DELETE",
          }),
          context
        ),
    ],
  ])("returns 404 for another owner's %s operation", async (_name, call) => {
    const response = await call()
    expect(response.status).toBe(404)
    expect(mocks.presignedGetUrl).not.toHaveBeenCalled()
    expect(mocks.deleteObject).not.toHaveBeenCalled()
    expect(mocks.runTranscription).not.toHaveBeenCalled()
    expect(mocks.runEnhancement).not.toHaveBeenCalled()
  })
})
