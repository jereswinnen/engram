import { NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { recordings } from "@/db/schema"
import { runEnhancement, runTranscription } from "@/lib/pipeline"
import { authorizeRecordingRequest } from "@/lib/recordings/auth"
import { isDirectUploadID } from "@/lib/recordings/direct-upload"
import { getStorage } from "@/lib/storage"

type RouteContext = { params: Promise<{ id: string }> }

function parseByteCount(value: unknown): number | null {
  if (!value || typeof value !== "object") return null
  const byteCount = (value as Record<string, unknown>).byteCount
  return typeof byteCount === "number" &&
    Number.isSafeInteger(byteCount) &&
    byteCount > 0
    ? byteCount
    : null
}

export async function POST(request: Request, context: RouteContext) {
  if ((await authorizeRecordingRequest(request)) !== "recorder") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: "A valid JSON body is required" },
      { status: 400 }
    )
  }
  const byteCount = parseByteCount(body)
  if (byteCount === null) {
    return NextResponse.json(
      { error: "byteCount must be a positive integer" },
      { status: 400 }
    )
  }

  const { id } = await context.params
  if (!isDirectUploadID(id)) {
    return NextResponse.json(
      { error: "id must be a valid UUID" },
      { status: 400 }
    )
  }
  const recording = await db.query.recordings.findFirst({
    where: eq(recordings.id, id),
  })
  if (!recording) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  if (recording.source !== "mac") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const result = { id: recording.id, url: `/recordings/${recording.id}` }
  if (recording.status !== "pending_upload") {
    return NextResponse.json(result)
  }

  const object = await getStorage().head(recording.storageKey)
  if (!object) {
    return NextResponse.json(
      { error: "Uploaded audio was not found. Retry the upload." },
      { status: 409 }
    )
  }
  if (object.size !== byteCount) {
    return NextResponse.json(
      { error: "Uploaded audio is incomplete. Retry the upload." },
      { status: 409 }
    )
  }

  const transitioned = await db
    .update(recordings)
    .set({ status: "uploaded", errorMessage: null })
    .where(
      and(
        eq(recordings.id, recording.id),
        eq(recordings.status, "pending_upload")
      )
    )
    .returning({ id: recordings.id })

  if (transitioned.length > 0) {
    runTranscription(recording.id)
      .then(() => runEnhancement(recording.id))
      .catch(() => {})
  }

  return NextResponse.json(result)
}
