import { sql } from "drizzle-orm"
import { db } from "@/db"
import { canReadUnownedLegacyRows } from "@/lib/auth/ownership"
import { config } from "@/lib/config"
import { embedSearchQuery } from "./embeddings"
import { renderSnippet, SNIPPET_END, SNIPPET_START } from "./snippet"

export interface SearchHit {
  id: string
  title: string
  createdAt: Date
  snippet: string
  matchType: "semantic" | "keyword"
  startSeconds: number | null
  score: number | null
}

const HEADLINE_OPTS = `StartSel=${SNIPPET_START}, StopSel=${SNIPPET_END}, MaxFragments=2, MinWords=5, MaxWords=18, FragmentDelimiter= … `

async function keywordSearch(
  ownerId: string,
  query: string
): Promise<SearchHit[]> {
  const includeUnownedLegacyRows = canReadUnownedLegacyRows(ownerId)
  const rows = (await db.execute(sql`
    SELECT r.id AS id,
           r.title AS title,
           r.created_at AS created_at,
           ts_headline('simple', t.full_text, websearch_to_tsquery('simple', ${query}), ${HEADLINE_OPTS}) AS snippet,
           ts_rank(t.search_vector, websearch_to_tsquery('simple', ${query})) AS score
    FROM transcriptions t
    JOIN recordings r ON r.id = t.recording_id
    WHERE (r.owner_id = ${ownerId} OR (${includeUnownedLegacyRows} AND r.owner_id IS NULL))
      AND (
        t.search_vector @@ websearch_to_tsquery('simple', ${query})
        OR to_tsvector('simple', r.title) @@ websearch_to_tsquery('simple', ${query})
      )
    ORDER BY score DESC
    LIMIT 20
  `)) as unknown as Array<{
    id: string
    title: string
    created_at: string | Date
    snippet: string | null
    score: number | string | null
  }>

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: new Date(row.created_at),
    snippet: renderSnippet(row.snippet ?? ""),
    matchType: "keyword",
    startSeconds: null,
    score: row.score === null ? null : Number(row.score),
  }))
}

async function semanticSearch(
  ownerId: string,
  query: string
): Promise<SearchHit[]> {
  const embedding = await embedSearchQuery(query)
  const vectorValue = JSON.stringify(embedding)
  const model = config.embeddingModel()
  const rows = (await db.execute(sql`
    SELECT embedding.recording_id AS id,
           recording.title AS title,
           recording.created_at AS created_at,
           embedding.content AS snippet,
           embedding.start_seconds AS start_seconds,
           1 - (embedding.embedding <=> ${vectorValue}::vector) AS score
    FROM transcript_embeddings embedding
    JOIN recordings recording ON recording.id = embedding.recording_id
    WHERE embedding.owner_id = ${ownerId}
      AND embedding.embedding_model = ${model}
      AND embedding.transcription_id = (
        SELECT transcription.id
        FROM transcriptions transcription
        WHERE transcription.recording_id = embedding.recording_id
        ORDER BY transcription.created_at DESC
        LIMIT 1
      )
      AND 1 - (embedding.embedding <=> ${vectorValue}::vector) >= 0.25
    ORDER BY embedding.embedding <=> ${vectorValue}::vector
    LIMIT 60
  `)) as unknown as Array<{
    id: string
    title: string
    created_at: string | Date
    snippet: string
    start_seconds: number | string | null
    score: number | string
  }>

  const seen = new Set<string>()
  const hits: SearchHit[] = []
  for (const row of rows) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    hits.push({
      id: row.id,
      title: row.title,
      createdAt: new Date(row.created_at),
      snippet: renderSnippet(row.snippet),
      matchType: "semantic",
      startSeconds:
        row.start_seconds === null ? null : Number(row.start_seconds),
      score: Number(row.score),
    })
    if (hits.length === 20) break
  }
  return hits
}

export async function searchRecordings(
  ownerId: string,
  q: string
): Promise<SearchHit[]> {
  const query = q.trim()
  if (!query) return []

  const keywordPromise = keywordSearch(ownerId, query)
  const semanticPromise = config.semanticSearchEnabled()
    ? semanticSearch(ownerId, query).catch((error) => {
        console.error(
          "[search] semantic search unavailable",
          error instanceof Error ? error.message : String(error)
        )
        return []
      })
    : Promise.resolve([])
  const [keywordHits, semanticHits] = await Promise.all([
    keywordPromise,
    semanticPromise,
  ])

  const combined = new Map<string, SearchHit>()
  for (const hit of keywordHits) combined.set(hit.id, hit)
  for (const hit of semanticHits) {
    if (!combined.has(hit.id)) combined.set(hit.id, hit)
  }
  return Array.from(combined.values()).slice(0, 20)
}
