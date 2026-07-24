import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { speakers, recordingSpeakers } from "@/db/schema"
import { ownerPredicate } from "@/lib/auth/ownership"
import { getOwnedRecording } from "@/lib/recordings/store"

// Names are stored/displayed as entered; dedupe is case-insensitive.
export async function findOrCreateSpeaker(
  ownerId: string,
  name: string
): Promise<{ id: string; name: string }> {
  const clean = name.trim()
  const normalizedName = clean.toLowerCase()
  const existing = await db.query.speakers.findFirst({
    where: and(
      ownerPredicate(speakers.ownerId, ownerId),
      eq(speakers.normalizedName, normalizedName)
    ),
  })
  if (existing) return { id: existing.id, name: existing.name }
  const [row] = await db
    .insert(speakers)
    .values({ ownerId, name: clean, normalizedName })
    .returning()
  return { id: row.id, name: row.name }
}

export async function listSpeakers(
  ownerId: string
): Promise<{ id: string; name: string }[]> {
  return (
    await db.query.speakers.findMany({
      where: ownerPredicate(speakers.ownerId, ownerId),
    })
  ).map((s) => ({ id: s.id, name: s.name }))
}

export async function getRecordingSpeakerMap(
  ownerId: string,
  recordingId: string
): Promise<Record<string, string>> {
  if (!(await getOwnedRecording(ownerId, recordingId))) return {}
  const rows = await db
    .select({ label: recordingSpeakers.label, name: speakers.name })
    .from(recordingSpeakers)
    .innerJoin(speakers, eq(speakers.id, recordingSpeakers.speakerId))
    .where(
      and(
        eq(recordingSpeakers.recordingId, recordingId),
        ownerPredicate(speakers.ownerId, ownerId)
      )
    )
  return Object.fromEntries(rows.map((r) => [r.label, r.name]))
}

export async function setRecordingSpeaker(
  ownerId: string,
  recordingId: string,
  label: string,
  name: string
): Promise<boolean> {
  if (!(await getOwnedRecording(ownerId, recordingId))) return false
  const clean = name.trim()
  if (!clean) {
    await db
      .delete(recordingSpeakers)
      .where(
        and(
          eq(recordingSpeakers.recordingId, recordingId),
          eq(recordingSpeakers.label, label)
        )
      )
    return true
  }
  const speaker = await findOrCreateSpeaker(ownerId, clean)
  const existing = await db.query.recordingSpeakers.findFirst({
    where: and(
      eq(recordingSpeakers.recordingId, recordingId),
      eq(recordingSpeakers.label, label)
    ),
  })
  if (existing) {
    await db
      .update(recordingSpeakers)
      .set({ speakerId: speaker.id })
      .where(eq(recordingSpeakers.id, existing.id))
  } else {
    await db
      .insert(recordingSpeakers)
      .values({ recordingId, label, speakerId: speaker.id })
  }
  return true
}
