import { db } from "@/db"
import { recordings } from "@/db/schema"
import { getOwnedRecording, ownedRecordingWhere } from "@/lib/recordings/store"
import { generatedTitleUpdate } from "@/lib/recordings/title-policy"
import { and, eq } from "drizzle-orm"

export async function applyGeneratedRecordingTitle(
  ownerId: string,
  recordingId: string,
  generatedTitle: string
): Promise<boolean> {
  const recording = await getOwnedRecording(ownerId, recordingId)
  if (!recording) return false

  const update = generatedTitleUpdate(recording, generatedTitle)
  if (!update) return false

  const [updated] = await db
    .update(recordings)
    .set(update)
    .where(
      and(
        ownedRecordingWhere(ownerId, recordingId),
        eq(recordings.titleOrigin, recording.titleOrigin)
      )
    )
    .returning({ id: recordings.id })
  return Boolean(updated)
}
