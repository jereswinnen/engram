import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { speakers, recordingSpeakers } from "@/db/schema";

export async function findOrCreateSpeaker(name: string): Promise<{ id: string; name: string }> {
  const clean = name.trim().toLowerCase();
  const existing = await db.query.speakers.findFirst({ where: eq(speakers.name, clean) });
  if (existing) return { id: existing.id, name: existing.name };
  const [row] = await db.insert(speakers).values({ name: clean }).returning();
  return { id: row.id, name: row.name };
}

export async function listSpeakers(): Promise<{ id: string; name: string }[]> {
  return (await db.query.speakers.findMany()).map((s) => ({ id: s.id, name: s.name }));
}

export async function getRecordingSpeakerMap(recordingId: string): Promise<Record<string, string>> {
  const rows = await db
    .select({ label: recordingSpeakers.label, name: speakers.name })
    .from(recordingSpeakers)
    .innerJoin(speakers, eq(speakers.id, recordingSpeakers.speakerId))
    .where(eq(recordingSpeakers.recordingId, recordingId));
  return Object.fromEntries(rows.map((r) => [r.label, r.name]));
}

export async function setRecordingSpeaker(
  recordingId: string,
  label: string,
  name: string,
): Promise<void> {
  const clean = name.trim();
  if (!clean) {
    await db
      .delete(recordingSpeakers)
      .where(
        and(
          eq(recordingSpeakers.recordingId, recordingId),
          eq(recordingSpeakers.label, label),
        ),
      );
    return;
  }
  const speaker = await findOrCreateSpeaker(clean);
  const existing = await db.query.recordingSpeakers.findFirst({
    where: and(
      eq(recordingSpeakers.recordingId, recordingId),
      eq(recordingSpeakers.label, label),
    ),
  });
  if (existing) {
    await db
      .update(recordingSpeakers)
      .set({ speakerId: speaker.id })
      .where(eq(recordingSpeakers.id, existing.id));
  } else {
    await db.insert(recordingSpeakers).values({ recordingId, label, speakerId: speaker.id });
  }
}
