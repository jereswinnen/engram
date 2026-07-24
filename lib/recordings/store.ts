import { and, desc, eq } from "drizzle-orm"
import { db } from "@/db"
import { aiEnhancements, recordings, transcriptions } from "@/db/schema"
import { ownerPredicate } from "@/lib/auth/ownership"
import { canReadUnownedLegacyRows } from "@/lib/auth/ownership"
import type { AuthPrincipal } from "@/lib/auth/principal"

export function ownedRecordingWhere(ownerId: string, recordingId: string) {
  return and(
    eq(recordings.id, recordingId),
    ownerPredicate(recordings.ownerId, ownerId)
  )!
}

export async function listOwnedRecordings(ownerId: string) {
  return db.query.recordings.findMany({
    where: ownerPredicate(recordings.ownerId, ownerId),
    orderBy: [desc(recordings.createdAt)],
  })
}

export async function getOwnedRecording(ownerId: string, recordingId: string) {
  return db.query.recordings.findFirst({
    where: ownedRecordingWhere(ownerId, recordingId),
  })
}

export function recordingBelongsToConnection(
  recording: {
    ownerId: string | null
    createdByConnectionId: string | null
    source: string
  },
  principal: AuthPrincipal
): boolean {
  if (!principal.connectionId) return false
  if (recording.createdByConnectionId === principal.connectionId) return true

  // Temporary rollback compatibility for a legacy pending queue created before
  // owner/connection columns existed. This is removed after the backfill soak.
  return (
    principal.mechanism === "legacy-mac" &&
    recording.ownerId === null &&
    recording.createdByConnectionId === null &&
    recording.source === "mac" &&
    canReadUnownedLegacyRows(principal.userId)
  )
}

export async function getOwnedRecordingBundle(
  ownerId: string,
  recordingId: string
) {
  const recording = await getOwnedRecording(ownerId, recordingId)
  if (!recording) return null

  const [transcription, enhancement] = await Promise.all([
    db.query.transcriptions.findFirst({
      where: eq(transcriptions.recordingId, recording.id),
      orderBy: [desc(transcriptions.createdAt)],
    }),
    db.query.aiEnhancements.findFirst({
      where: eq(aiEnhancements.recordingId, recording.id),
      orderBy: [desc(aiEnhancements.createdAt)],
    }),
  ])

  return { recording, transcription, enhancement }
}
