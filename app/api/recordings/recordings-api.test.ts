import { beforeEach, describe, expect, it, vi } from "vitest"

const calls = vi.hoisted(() => ({
  inserts: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  stored: [] as { key: string; body: Buffer; contentType: string }[],
}))

vi.mock("@/auth", () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock("@/lib/auth/connections", () => ({
  ensureActivePrincipalConnection: vi.fn(async () => true),
}))

vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          calls.inserts.push(values)
          return [{ id: "recording-1", ...values }]
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          calls.updates.push(values)
        },
      }),
    }),
    query: { recordings: { findMany: vi.fn(async () => []) } },
  },
}))

vi.mock("@/lib/storage", () => ({
  buildAudioKey: (id: string, filename: string) => `audio/${id}/${filename}`,
  getStorage: () => ({
    put: vi.fn(async (key: string, body: Buffer, contentType: string) => {
      calls.stored.push({ key, body, contentType })
    }),
  }),
}))

vi.mock("@/lib/pipeline", () => ({
  runTranscription: vi.fn(async () => {}),
  runEnhancement: vi.fn(async () => {}),
}))

function uploadRequest(
  fields: Record<string, string> = {},
  headers: Record<string, string> = {}
) {
  const form = new FormData()
  form.set("file", new File(["audio"], "meeting.m4a", { type: "audio/mp4" }))
  for (const [name, value] of Object.entries(fields)) form.set(name, value)
  return new Request("http://localhost/api/recordings", {
    method: "POST",
    headers,
    body: form,
  })
}

beforeEach(async () => {
  calls.inserts.length = 0
  calls.updates.length = 0
  calls.stored.length = 0
  process.env.MAC_RECORDER_API_TOKEN = "recorder-secret"
  process.env.LEGACY_MAC_RECORDER_OWNER_ID = "user-1"
  process.env.AUTH_LEGACY_MAC_ENABLED = "true"
  const { auth } = await import("@/auth")
  vi.mocked(auth.api.getSession).mockReset()
  vi.mocked(auth.api.getSession).mockResolvedValue(null)
})

describe("POST /api/recordings", () => {
  it("accepts the Mac recorder token and persists recorder metadata", async () => {
    const { POST } = await import("./route")
    const response = await POST(
      uploadRequest(
        {
          source: "mac",
          title: "Weekly sync",
          durationSeconds: "125",
          startedAt: "2026-07-10T08:30:00.000Z",
        },
        { authorization: "Bearer recorder-secret" }
      ) as never
    )

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      id: "recording-1",
      url: "/recordings/recording-1",
    })
    expect(calls.inserts).toEqual([
      expect.objectContaining({
        title: "Weekly sync",
        source: "mac",
        ownerId: "user-1",
        createdByConnectionId: "00000000-0000-4000-8000-000000000001",
        durationSeconds: 125,
        createdAt: new Date("2026-07-10T08:30:00.000Z"),
        contentType: "audio/mp4",
      }),
    ])
    expect(calls.stored).toEqual([
      expect.objectContaining({
        key: "audio/recording-1/meeting.m4a",
        contentType: "audio/mp4",
      }),
    ])
    expect(calls.updates).toEqual([
      { storageKey: "audio/recording-1/meeting.m4a" },
    ])
    const { runTranscription, runEnhancement } = await import("@/lib/pipeline")
    expect(runTranscription).toHaveBeenCalledWith("user-1", "recording-1")
    await vi.waitFor(() =>
      expect(runEnhancement).toHaveBeenCalledWith("user-1", "recording-1")
    )
  })

  it("keeps browser-session uploads working with existing defaults", async () => {
    const { auth } = await import("@/auth")
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      user: { id: "user-1" },
    } as never)
    const { POST } = await import("./route")

    const response = await POST(uploadRequest() as never)

    expect(response.status).toBe(201)
    expect(calls.inserts[0]).toMatchObject({
      title: "meeting.m4a",
      source: "upload",
      ownerId: "user-1",
      durationSeconds: null,
    })
    expect(calls.inserts[0]).not.toHaveProperty("createdAt")
  })

  it("rejects unauthenticated uploads before parsing or storing them", async () => {
    const { POST } = await import("./route")
    const response = await POST(
      uploadRequest({}, { authorization: "Bearer wrong" }) as never
    )

    expect(response.status).toBe(401)
    expect(calls.inserts).toHaveLength(0)
    expect(calls.stored).toHaveLength(0)
  })

  it("does not accept Bearer undefined when the recorder token is unset", async () => {
    delete process.env.MAC_RECORDER_API_TOKEN
    const { POST } = await import("./route")
    const response = await POST(
      uploadRequest({}, { authorization: "Bearer undefined" }) as never
    )

    expect(response.status).toBe(401)
  })

  it.each([
    [
      { durationSeconds: "12.5" },
      "durationSeconds must be a non-negative integer",
    ],
    [
      { durationSeconds: "-1" },
      "durationSeconds must be a non-negative integer",
    ],
    [{ startedAt: "not-a-date" }, "startedAt must be a valid date"],
    [{ source: "plaud" }, "source must be upload or mac"],
  ])("rejects invalid metadata %j", async (fields, error) => {
    const { POST } = await import("./route")
    const response = await POST(
      uploadRequest(fields, {
        authorization: "Bearer recorder-secret",
      }) as never
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error })
    expect(calls.inserts).toHaveLength(0)
  })
})
