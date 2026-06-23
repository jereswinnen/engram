import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { recordings, transcriptions, aiEnhancements } from "@/db/schema";
import { getStorage } from "@/lib/storage";
import { transcribeWithScribe } from "@/lib/transcription/scribe";
import { enhanceTranscript } from "@/lib/ai/enhance";
import { config } from "@/lib/config";
import { getGlossary } from "@/lib/glossary/store";
import { toKeyterms, applyAliasCorrections, glossaryPromptBlock } from "@/lib/glossary/apply";

async function setStatus(id: string, status: string, errorMessage: string | null = null) {
  await db.update(recordings).set({ status, errorMessage }).where(eq(recordings.id, id));
}

export async function runTranscription(id: string): Promise<void> {
  try {
    await setStatus(id, "transcribing");
    const rec = await db.query.recordings.findFirst({ where: eq(recordings.id, id) });
    if (!rec) throw new Error(`recording ${id} not found`);
    const glossary = await getGlossary().catch(() => []);
    const url = await getStorage().presignedGetUrl(rec.storageKey, 3600);
    const result = await transcribeWithScribe({ cloudStorageUrl: url }, { keyterms: toKeyterms(glossary) });
    const correctedText = applyAliasCorrections(result.text, glossary);
    const correctedSegments = result.segments.map((s) => ({ ...s, text: applyAliasCorrections(s.text, glossary) }));
    await db.insert(transcriptions).values({
      recordingId: id,
      fullText: correctedText,
      rawText: result.text,
      language: result.language ?? null,
      segments: correctedSegments,
    });
    await setStatus(id, "transcribed");
  } catch (e) {
    try {
      await setStatus(id, "error", e instanceof Error ? e.message : String(e));
    } catch {
      // DB unavailable while recording error status — nothing further we can do
    }
  }
}

export async function runEnhancement(id: string): Promise<void> {
  try {
    await setStatus(id, "enhancing");
    const t = await db.query.transcriptions.findFirst({ where: eq(transcriptions.recordingId, id), orderBy: [desc(transcriptions.createdAt)] });
    if (!t) throw new Error(`transcription for ${id} not found`);
    const glossary = await getGlossary().catch(() => []);
    const e = await enhanceTranscript(t.fullText, { glossaryBlock: glossaryPromptBlock(glossary) });
    await db.insert(aiEnhancements).values({
      recordingId: id,
      title: e.title,
      summary: e.summary,
      actionItems: e.actionItems,
      keyPoints: e.keyPoints,
      model: config.llmModel(),
    });
    await setStatus(id, "done");
  } catch (err) {
    try {
      await setStatus(id, "error", err instanceof Error ? err.message : String(err));
    } catch {
      // DB unavailable while recording error status — nothing further we can do
    }
  }
}
