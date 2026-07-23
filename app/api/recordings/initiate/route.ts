import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { recordings } from "@/db/schema"
import { authorizeRecordingRequest } from "@/lib/recordings/auth"
import { parseDirectUploadRequest } from "@/lib/recordings/direct-upload"
import { buildAudioKey, getStorage } from "@/lib/storage"

const CONTENT_TYPE = "audio/mp4"

export async function POST(request: Request) {
  if ((await authorizeRecordingRequest(request)) !== "recorder") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const parsed = await parseDirectUploadRequest(request)
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  const { id, title, durationSeconds, startedAt, byteCount } = parsed.input
  const storageKey = buildAudioKey(id, "recording.m4a")
  let recording = await db.query.recordings.findFirst({
    where: eq(recordings.id, id),
  })

  if (!recording) {
    const inserted = await db
      .insert(recordings)
      .values({
        id,
        title,
        source: "mac",
        storageKey,
        contentType: CONTENT_TYPE,
        durationSeconds,
        status: "pending_upload",
        createdAt: startedAt,
      })
      .onConflictDoNothing({ target: recordings.id })
      .returning()

    recording =
      inserted[0] ??
      (await db.query.recordings.findFirst({
        where: eq(recordings.id, id),
      }))
  }

  if (!recording) {
    return NextResponse.json(
      { error: "Could not initialize the upload" },
      { status: 500 }
    )
  }
  if (recording.source !== "mac") {
    return NextResponse.json(
      { error: "Recording ID is already in use" },
      { status: 409 }
    )
  }

  const url = `/recordings/${recording.id}`
  if (recording.status !== "pending_upload") {
    return NextResponse.json({
      id: recording.id,
      url,
      completed: true,
      upload: null,
    })
  }

  const storage = getStorage()
  const existingObject = await storage.head(recording.storageKey)
  if (existingObject?.size === byteCount) {
    return NextResponse.json({
      id: recording.id,
      url,
      completed: false,
      upload: null,
    })
  }

  const uploadURL = await storage.presignedPutUrl(
    recording.storageKey,
    CONTENT_TYPE
  )
  return NextResponse.json({
    id: recording.id,
    url,
    completed: false,
    upload: {
      url: uploadURL,
      headers: { "Content-Type": CONTENT_TYPE },
    },
  })
}
