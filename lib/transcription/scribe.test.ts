import { describe, it, expect, vi, afterEach } from "vitest"
import { transcribeWithScribe, wordsToSegments } from "./scribe"

function okResponse() {
  return new Response(
    JSON.stringify({ text: "hoi", language_code: "nld", words: [] }),
    { status: 200 }
  )
}

describe("transcribeWithScribe keyterms", () => {
  afterEach(() => vi.restoreAllMocks())

  it("encodes each keyterm as a repeated multipart field", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(okResponse())
    await transcribeWithScribe(
      { cloudStorageUrl: "https://x" },
      { apiKey: "k", keyterms: ["Riffado", "Engram"] }
    )
    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData
    expect(body.getAll("keyterms")).toEqual(["Riffado", "Engram"])
  })

  it("omits keyterms when none provided", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(okResponse())
    await transcribeWithScribe(
      { cloudStorageUrl: "https://x" },
      { apiKey: "k" }
    )
    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData
    expect(body.get("keyterms")).toBeNull()
  })

  it("retries once without keyterms when Scribe rejects a keyword", async () => {
    const invalidKeyword = new Response(
      JSON.stringify({
        detail: {
          type: "validation_error",
          code: "invalid_parameters",
          status: "invalid_keyword",
          param: "keywords",
        },
      }),
      { status: 400 }
    )
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(invalidKeyword)
      .mockResolvedValueOnce(okResponse())

    await transcribeWithScribe(
      { cloudStorageUrl: "https://x" },
      { apiKey: "k", keyterms: ["Odoo"] }
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstBody = (fetchMock.mock.calls[0][1] as RequestInit)
      .body as FormData
    const retryBody = (fetchMock.mock.calls[1][1] as RequestInit)
      .body as FormData
    expect(firstBody.getAll("keyterms")).toEqual(["Odoo"])
    expect(retryBody.get("keyterms")).toBeNull()
  })

  it("does not retry unrelated Scribe failures", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: { status: "invalid_audio" } }), {
        status: 400,
      })
    )

    await expect(
      transcribeWithScribe(
        { cloudStorageUrl: "https://x" },
        { apiKey: "k", keyterms: ["Odoo"] }
      )
    ).rejects.toThrow("Scribe failed: 400")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("wordsToSegments", () => {
  it("groups consecutive words by speaker", () => {
    const segs = wordsToSegments([
      { text: "Hallo", start: 0, end: 1, speaker_id: "A" },
      { text: " daar", start: 1, end: 2, speaker_id: "A" },
      { text: "Goeie", start: 2, end: 3, speaker_id: "B" },
    ])
    expect(segs).toHaveLength(2)
    expect(segs[0]).toMatchObject({
      speaker: "A",
      text: "Hallo daar",
      start: 0,
      end: 2,
    })
    expect(segs[1]).toMatchObject({
      speaker: "B",
      text: "Goeie",
      start: 2,
      end: 3,
    })
  })

  it("drops audio_event tokens", () => {
    const segs = wordsToSegments([
      { text: "(gelach)", type: "audio_event", speaker_id: "A" },
      { text: "Hoi", start: 1, end: 2, type: "word", speaker_id: "A" },
    ])
    expect(segs).toHaveLength(1)
    expect(segs[0].text).toBe("Hoi")
  })
})
