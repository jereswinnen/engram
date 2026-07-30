import { z } from "zod"
import { getOwnedRecordingBundle } from "./store"
import { getRecordingSpeakerMap } from "@/lib/speakers/store"
import { nameForLabel } from "@/lib/transcript/speaker-names"

export type TranscriptSegment = {
  start: number
  end: number
  text: string
  speaker?: string | null
}

export type OwnedTranscriptDocument = {
  recording: {
    id: string
    title: string
    createdAt: Date
    durationSeconds: number | null
  }
  transcription: {
    id: string
    language: string | null
    segments: TranscriptSegment[]
  }
  speakerMap: Record<string, string>
}

export type OwnedSummaryDocument = {
  recording: {
    id: string
    title: string
    createdAt: Date
  }
  overview: string
  keyPoints: string[]
  decisions: string[]
  actionItems: Array<{
    text: string
    owner: string | null
    due: string | null
  }>
  chapters: Array<{
    title: string
    gist: string
    startSeconds: number | null
  }>
  openQuestions: string[]
}

export type TranscriptPage = {
  recording: OwnedTranscriptDocument["recording"] & { language: string | null }
  segments: Array<{
    index: number
    startSeconds: number
    endSeconds: number
    speaker: string | null
    text: string
  }>
  nextCursor: string | null
}

export type TranscriptPageResult =
  | { ok: true; page: TranscriptPage }
  | { ok: false; error: "not_found" | "invalid_cursor" | "stale_cursor" }

type RecordingBundle = Awaited<ReturnType<typeof getOwnedRecordingBundle>>

type DocumentDependencies = {
  getBundle?: (
    ownerId: string,
    recordingId: string
  ) => Promise<RecordingBundle>
  getSpeakerMap?: (
    ownerId: string,
    recordingId: string
  ) => Promise<Record<string, string>>
}

const cursorSchema = z
  .object({
    v: z.literal(1),
    transcriptionId: z.uuid(),
    offset: z.number().int().nonnegative(),
  })
  .strict()

type TranscriptCursor = z.infer<typeof cursorSchema>

export function encodeTranscriptCursor(cursor: TranscriptCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")
}

export function decodeTranscriptCursor(value: string): TranscriptCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
    const result = cursorSchema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export async function getOwnedTranscriptDocument(
  ownerId: string,
  recordingId: string,
  dependencies: DocumentDependencies = {}
): Promise<OwnedTranscriptDocument | null> {
  const getBundle = dependencies.getBundle ?? getOwnedRecordingBundle
  const bundle = await getBundle(ownerId, recordingId)
  if (!bundle?.transcription) return null

  const getSpeakerMap = dependencies.getSpeakerMap ?? getRecordingSpeakerMap
  const speakerMap = await getSpeakerMap(ownerId, recordingId).catch(() => ({}))

  return {
    recording: {
      id: bundle.recording.id,
      title: bundle.recording.title,
      createdAt: bundle.recording.createdAt,
      durationSeconds: bundle.recording.durationSeconds,
    },
    transcription: {
      id: bundle.transcription.id,
      language: bundle.transcription.language,
      segments: bundle.transcription.segments as TranscriptSegment[],
    },
    speakerMap,
  }
}

export async function getOwnedTranscriptPage(
  ownerId: string,
  recordingId: string,
  options: { cursor?: string; limit?: number } = {},
  dependencies: DocumentDependencies = {}
): Promise<TranscriptPageResult> {
  const document = await getOwnedTranscriptDocument(
    ownerId,
    recordingId,
    dependencies
  )
  if (!document) return { ok: false, error: "not_found" }

  const cursor = options.cursor
    ? decodeTranscriptCursor(options.cursor)
    : {
        v: 1 as const,
        transcriptionId: document.transcription.id,
        offset: 0,
      }
  if (!cursor) return { ok: false, error: "invalid_cursor" }
  if (cursor.transcriptionId !== document.transcription.id) {
    return { ok: false, error: "stale_cursor" }
  }

  const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 50), 100))
  const source = document.transcription.segments
  const pageSegments = source
    .slice(cursor.offset, cursor.offset + limit)
    .map((segment, relativeIndex) => ({
      index: cursor.offset + relativeIndex,
      startSeconds: segment.start,
      endSeconds: segment.end,
      speaker: segment.speaker
        ? nameForLabel(segment.speaker, document.speakerMap)
        : null,
      text: segment.text,
    }))
  const nextOffset = cursor.offset + pageSegments.length

  return {
    ok: true,
    page: {
      recording: {
        ...document.recording,
        language: document.transcription.language,
      },
      segments: pageSegments,
      nextCursor:
        nextOffset < source.length
          ? encodeTranscriptCursor({
              v: 1,
              transcriptionId: document.transcription.id,
              offset: nextOffset,
            })
          : null,
    },
  }
}

export async function getOwnedSummary(
  ownerId: string,
  recordingId: string,
  dependencies: Pick<DocumentDependencies, "getBundle"> = {}
): Promise<OwnedSummaryDocument | null> {
  const getBundle = dependencies.getBundle ?? getOwnedRecordingBundle
  const bundle = await getBundle(ownerId, recordingId)
  if (!bundle?.enhancement) return null

  return {
    recording: {
      id: bundle.recording.id,
      title: bundle.recording.title,
      createdAt: bundle.recording.createdAt,
    },
    overview: bundle.enhancement.overview,
    keyPoints: bundle.enhancement.keyPoints,
    decisions: bundle.enhancement.decisions,
    actionItems: bundle.enhancement.actionItems.map((item) => ({
      text: item.text,
      owner: item.owner ?? null,
      due: item.due ?? null,
    })),
    chapters: bundle.enhancement.chapters.map((chapter) => ({
      title: chapter.title,
      gist: chapter.gist,
      startSeconds: chapter.startSeconds ?? null,
    })),
    openQuestions: bundle.enhancement.openQuestions,
  }
}
