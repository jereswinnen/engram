import { and, desc, eq, gte, ne, or, sql } from "drizzle-orm"
import { embed, embedMany } from "ai"
import { createOpenAI } from "@ai-sdk/openai"
import { db } from "@/db"
import {
  aiEnhancements,
  transcriptEmbeddings,
  transcriptions,
} from "@/db/schema"
import { config } from "@/lib/config"
import { getOwnedRecording } from "@/lib/recordings/store"
import { getRecordingSpeakerMap } from "@/lib/speakers/store"
import { chunkTranscript, type TranscriptSegment } from "./chunks"
import { SEARCH_EMBEDDING_VERSION } from "./constants"

const INSERT_BATCH_SIZE = 25
const EMBEDDING_DIMENSIONS = 1_536

export async function embedSearchQuery(query: string): Promise<number[]> {
  const openai = createOpenAI({ apiKey: config.openAiApiKey() })
  const result = await embed({
    model: openai.embedding(config.embeddingModel()),
    value: query,
    providerOptions: { openai: { dimensions: EMBEDDING_DIMENSIONS } },
  })
  return result.embedding
}

export type EmbeddingResult = {
  recordingId: string
  transcriptionId: string
  chunks: number
  tokens: number
  skipped: boolean
}

function inBatches<T>(values: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size))
  }
  return batches
}

export async function embedLatestTranscript(
  ownerId: string,
  recordingId: string,
  options: { dryRun?: boolean } = {}
): Promise<EmbeddingResult> {
  const recording = await getOwnedRecording(ownerId, recordingId)
  if (!recording) throw new Error(`recording ${recordingId} not found`)

  const transcription = await db.query.transcriptions.findFirst({
    where: eq(transcriptions.recordingId, recordingId),
    orderBy: [desc(transcriptions.createdAt)],
  })
  if (!transcription) {
    throw new Error(`transcription for ${recordingId} not found`)
  }

  const [enhancement, speakerMap] = await Promise.all([
    db.query.aiEnhancements.findFirst({
      where: eq(aiEnhancements.recordingId, recordingId),
      orderBy: [desc(aiEnhancements.createdAt)],
    }),
    getRecordingSpeakerMap(ownerId, recordingId).catch(() => ({})),
  ])
  const chunks = chunkTranscript(
    transcription.segments as TranscriptSegment[],
    transcription.fullText,
    {
      speakerMap,
      context: [
        `Recording title: ${recording.title}`,
        enhancement?.title && enhancement.title !== recording.title
          ? `Suggested title: ${enhancement.title}`
          : "",
        enhancement?.overview
          ? `Recording summary: ${enhancement.overview}`
          : "",
      ],
    }
  )
  if (chunks.length === 0) {
    return {
      recordingId,
      transcriptionId: transcription.id,
      chunks: 0,
      tokens: 0,
      skipped: true,
    }
  }

  const model = config.embeddingModel()
  const existing = await db.query.transcriptEmbeddings.findMany({
    where: and(
      eq(transcriptEmbeddings.transcriptionId, transcription.id),
      eq(transcriptEmbeddings.embeddingModel, model),
      eq(transcriptEmbeddings.embeddingVersion, SEARCH_EMBEDDING_VERSION)
    ),
  })
  const existingHashes = new Map(
    existing.map((row) => [row.chunkIndex, row.contentHash])
  )
  const isCurrent =
    existing.length === chunks.length &&
    chunks.every(
      (chunk) => existingHashes.get(chunk.index) === chunk.contentHash
    )

  if (isCurrent || options.dryRun) {
    return {
      recordingId,
      transcriptionId: transcription.id,
      chunks: chunks.length,
      tokens: 0,
      skipped: isCurrent,
    }
  }

  const openai = createOpenAI({ apiKey: config.openAiApiKey() })
  const generated = await embedMany({
    model: openai.embedding(model),
    values: chunks.map((chunk) => chunk.content),
    maxParallelCalls: 2,
    providerOptions: { openai: { dimensions: EMBEDDING_DIMENSIONS } },
  })

  const rows = chunks.map((chunk, index) => ({
    ownerId,
    recordingId,
    transcriptionId: transcription.id,
    chunkIndex: chunk.index,
    content: chunk.content,
    contentHash: chunk.contentHash,
    startSeconds: chunk.startSeconds,
    endSeconds: chunk.endSeconds,
    embeddingModel: model,
    embeddingVersion: SEARCH_EMBEDDING_VERSION,
    embedding: generated.embeddings[index],
  }))

  await db.transaction(async (transaction) => {
    for (const batch of inBatches(rows, INSERT_BATCH_SIZE)) {
      await transaction
        .insert(transcriptEmbeddings)
        .values(batch)
        .onConflictDoUpdate({
          target: [
            transcriptEmbeddings.transcriptionId,
            transcriptEmbeddings.chunkIndex,
            transcriptEmbeddings.embeddingModel,
          ],
          set: {
            ownerId: sql`excluded.owner_id`,
            recordingId: sql`excluded.recording_id`,
            content: sql`excluded.content`,
            contentHash: sql`excluded.content_hash`,
            embeddingVersion: sql`excluded.embedding_version`,
            startSeconds: sql`excluded.start_seconds`,
            endSeconds: sql`excluded.end_seconds`,
            embedding: sql`excluded.embedding`,
            updatedAt: new Date(),
          },
        })
    }
    await transaction
      .delete(transcriptEmbeddings)
      .where(
        and(
        eq(transcriptEmbeddings.transcriptionId, transcription.id),
        eq(transcriptEmbeddings.embeddingModel, model),
        or(
          ne(transcriptEmbeddings.embeddingVersion, SEARCH_EMBEDDING_VERSION),
          gte(transcriptEmbeddings.chunkIndex, chunks.length)
        )
      )
      )
  })

  return {
    recordingId,
    transcriptionId: transcription.id,
    chunks: chunks.length,
    tokens: generated.usage.tokens,
    skipped: false,
  }
}

export async function listEmbeddingBackfillCandidates(
  options: { limit?: number; recordingId?: string } = {}
): Promise<Array<{ ownerId: string; recordingId: string }>> {
  const limit = Math.max(1, Math.min(options.limit ?? 10, 100))
  const model = config.embeddingModel()
  const recordingFilter = options.recordingId
    ? sql`AND r.id = ${options.recordingId}`
    : sql``

  const rows = (await db.execute(sql`
    WITH latest_transcriptions AS (
      SELECT DISTINCT ON (r.id)
             r.id AS recording_id,
             r.owner_id AS owner_id,
             t.id AS transcription_id,
             t.full_text AS full_text
      FROM recordings r
      JOIN transcriptions t ON t.recording_id = r.id
      WHERE r.owner_id IS NOT NULL
      ${recordingFilter}
      ORDER BY r.id, t.created_at DESC
    )
    SELECT latest.recording_id, latest.owner_id
    FROM latest_transcriptions latest
    WHERE length(trim(latest.full_text)) > 0
      AND NOT EXISTS (
      SELECT 1
      FROM transcript_embeddings embedding
      WHERE embedding.transcription_id = latest.transcription_id
        AND embedding.embedding_model = ${model}
        AND embedding.embedding_version = ${SEARCH_EMBEDDING_VERSION}
    )
    ORDER BY latest.recording_id
    LIMIT ${limit}
  `)) as unknown as Array<{ recording_id: string; owner_id: string }>

  return rows.map((row) => ({
    ownerId: row.owner_id,
    recordingId: row.recording_id,
  }))
}

export async function runTranscriptEmbedding(
  ownerId: string,
  recordingId: string
): Promise<void> {
  try {
    await embedLatestTranscript(ownerId, recordingId)
  } catch (error) {
    console.error(
      "[embeddings] generation failed",
      recordingId,
      error instanceof Error ? error.message : String(error)
    )
  }
}
