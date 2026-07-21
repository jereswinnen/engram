import { eq } from "drizzle-orm"
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/db"
import { recordings } from "@/db/schema"
import { authorizeRecordingRequest } from "@/lib/recordings/auth"
import { getStorage } from "@/lib/storage"

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authorization = await authorizeRecordingRequest(request)
  if (!authorization) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const recording = await db.query.recordings.findFirst({
    where: eq(recordings.id, id),
  })
  if (!recording) {
    return NextResponse.json({ error: "Recording not found" }, { status: 404 })
  }

  if (authorization === "recorder" && recording.source !== "mac") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    // Delete storage first so a transient R2 failure leaves the database row
    // available for a safe retry. R2 object deletion is idempotent.
    await getStorage().delete(recording.storageKey)
    await db.delete(recordings).where(eq(recordings.id, id))
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[recording delete]", { id, error })
    return NextResponse.json(
      { error: "Could not delete the recording" },
      { status: 500 }
    )
  }
}
