import { eq, desc } from "drizzle-orm"
import { db } from "@/db"
import { recordings, transcriptions, aiEnhancements } from "@/db/schema"
import { getStorage } from "@/lib/storage"
import { transcribeWithScribe } from "@/lib/transcription/scribe"
import { enhanceTranscript } from "@/lib/ai/enhance"
import { buildNamedTranscript } from "@/lib/transcript/speaker-names"
import { config } from "@/lib/config"
import { getGlossary } from "@/lib/glossary/store"
import {
  toKeyterms,
  applyAliasCorrections,
  glossaryPromptBlock,
} from "@/lib/glossary/apply"
import { getRecordingSpeakerMap } from "@/lib/speakers/store"
import { getOwnedRecording, ownedRecordingWhere } from "@/lib/recordings/store"

async function setStatus(
  ownerId: string,
  id: string,
  status: string,
  errorMessage: string | null = null
) {
  await db
    .update(recordings)
    .set({ status, errorMessage })
    .where(ownedRecordingWhere(ownerId, id))
}

export async function runTranscription(
  ownerId: string,
  id: string
): Promise<void> {
  try {
    const rec = await getOwnedRecording(ownerId, id)
    if (!rec) throw new Error(`recording ${id} not found`)
    await setStatus(ownerId, id, "transcribing")
    const glossary = await getGlossary(ownerId).catch(() => [])
    const url = await getStorage().presignedGetUrl(rec.storageKey, 3600)
    const result = await transcribeWithScribe(
      { cloudStorageUrl: url },
      { keyterms: toKeyterms(glossary) }
    )
    const correctedText = applyAliasCorrections(result.text, glossary)
    const correctedSegments = result.segments.map((s) => ({
      ...s,
      text: applyAliasCorrections(s.text, glossary),
    }))
    await db.insert(transcriptions).values({
      recordingId: id,
      fullText: correctedText,
      rawText: result.text,
      language: result.language ?? null,
      segments: correctedSegments,
    })
    await setStatus(ownerId, id, "transcribed")
  } catch (e) {
    try {
      await setStatus(
        ownerId,
        id,
        "error",
        e instanceof Error ? e.message : String(e)
      )
    } catch {
      // DB unavailable while recording error status — nothing further we can do
    }
  }
}

export async function runEnhancement(
  ownerId: string,
  id: string
): Promise<void> {
  try {
    const rec = await getOwnedRecording(ownerId, id)
    if (!rec) throw new Error(`recording ${id} not found`)
    await setStatus(ownerId, id, "enhancing")
    const t = await db.query.transcriptions.findFirst({
      where: eq(transcriptions.recordingId, id),
      orderBy: [desc(transcriptions.createdAt)],
    })
    if (!t) throw new Error(`transcription for ${id} not found`)
    const glossary = await getGlossary(ownerId).catch(() => [])
    const map = await getRecordingSpeakerMap(ownerId, id).catch(() => ({}))
    const transcript = buildNamedTranscript(t.segments, map)
    const e = await enhanceTranscript(transcript, {
      glossaryBlock: glossaryPromptBlock(glossary),
    })
    await db.delete(aiEnhancements).where(eq(aiEnhancements.recordingId, id))
    await db.insert(aiEnhancements).values({
      recordingId: id,
      title: e.title,
      overview: e.overview,
      keyPoints: e.keyPoints,
      decisions: e.decisions,
      actionItems: e.actionItems,
      chapters: e.chapters,
      openQuestions: e.openQuestions,
      model: config.llmModel(),
    })
    await setStatus(ownerId, id, "done")
  } catch (err) {
    try {
      await setStatus(
        ownerId,
        id,
        "error",
        err instanceof Error ? err.message : String(err)
      )
    } catch {
      // DB unavailable while recording error status — nothing further we can do
    }
  }
}
