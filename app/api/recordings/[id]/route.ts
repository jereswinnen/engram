import { NextRequest, NextResponse } from "next/server"
import { db } from "@/db"
import { recordings } from "@/db/schema"
import { isAuthFailure, requirePrincipal } from "@/lib/auth/policy"
import {
  getOwnedRecording,
  ownedRecordingWhere,
  recordingBelongsToConnection,
} from "@/lib/recordings/store"
import { getStorage } from "@/lib/storage"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const principal = await requirePrincipal(request, {
    scopes: ["recordings:write"],
    mechanisms: ["legacy-mac", "oauth"],
  })
  if (isAuthFailure(principal)) return principal

  const { id } = await params
  const recording = await getOwnedRecording(principal.userId, id)
  if (!recording || !recordingBelongsToConnection(recording, principal)) {
    return NextResponse.json({ error: "Recording not found" }, { status: 404 })
  }

  return NextResponse.json({
    id: recording.id,
    title: recording.title,
    titleOrigin: recording.titleOrigin,
    status: recording.status,
  })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const principal = await requirePrincipal(request, {
    scopes: ["recordings:delete-own"],
  })
  if (isAuthFailure(principal)) return principal

  const { id } = await params
  const recording = await getOwnedRecording(principal.userId, id)
  if (!recording) {
    return NextResponse.json({ error: "Recording not found" }, { status: 404 })
  }

  if (
    principal.mechanism !== "session" &&
    !recordingBelongsToConnection(recording, principal)
  ) {
    return NextResponse.json({ error: "Recording not found" }, { status: 404 })
  }

  try {
    // Delete storage first so a transient R2 failure leaves the database row
    // available for a safe retry. R2 object deletion is idempotent.
    await getStorage().delete(recording.storageKey)
    await db.delete(recordings).where(ownedRecordingWhere(principal.userId, id))
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[recording delete]", { id, error })
    return NextResponse.json(
      { error: "Could not delete the recording" },
      { status: 500 }
    )
  }
}
