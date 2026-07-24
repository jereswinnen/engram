import { NextResponse } from "next/server"
import { db } from "@/db"
import { recordings } from "@/db/schema"
import { isAuthFailure, requirePrincipal } from "@/lib/auth/policy"
import { parseDirectUploadRequest } from "@/lib/recordings/direct-upload"
import {
  getOwnedRecording,
  recordingBelongsToConnection,
} from "@/lib/recordings/store"
import { buildAudioKey, getStorage } from "@/lib/storage"

const CONTENT_TYPE = "audio/mp4"

export async function POST(request: Request) {
  const principal = await requirePrincipal(request, {
    scopes: ["recordings:write"],
    mechanisms: ["legacy-mac", "oauth"],
  })
  if (isAuthFailure(principal)) return principal

  const parsed = await parseDirectUploadRequest(request)
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  const { id, title, durationSeconds, startedAt, byteCount } = parsed.input
  const storageKey = buildAudioKey(id, "recording.m4a")
  let recording = await getOwnedRecording(principal.userId, id)

  if (!recording) {
    const inserted = await db
      .insert(recordings)
      .values({
        id,
        ownerId: principal.userId,
        createdByConnectionId: principal.connectionId,
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

    recording = inserted[0] ?? (await getOwnedRecording(principal.userId, id))
  }

  if (!recording) {
    return NextResponse.json(
      { error: "Recording ID is already in use" },
      { status: 409 }
    )
  }
  if (!recordingBelongsToConnection(recording, principal)) {
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
