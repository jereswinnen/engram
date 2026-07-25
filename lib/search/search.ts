import { sql } from "drizzle-orm"
import { db } from "@/db"
import { config } from "@/lib/config"
import {
  SEARCH_DEFAULT_LIMIT,
  SEARCH_EMBEDDING_VERSION,
  SEARCH_MAX_LIMIT,
  SEARCH_MAX_OFFSET,
  LEGACY_SEARCH_EMBEDDING_VERSION,
} from "./constants"
import { embedSearchQuery } from "./embeddings"
import { renderSnippet, SNIPPET_END, SNIPPET_START } from "./snippet"

export interface SearchHit {
  passageId: string
  recordingId: string
  title: string
  createdAt: Date
  snippet: string
  matchType: "hybrid" | "semantic" | "keyword"
  startSeconds: number | null
  endSeconds: number | null
  score: number
  similarity: number | null
}

export interface SearchPage {
  results: SearchHit[]
  pagination: {
    limit: number
    offset: number
    hasMore: boolean
  }
}

type SearchOptions = {
  limit?: number
  offset?: number
}

type SearchRow = {
  passage_id: string
  recording_id: string
  title: string
  created_at: string | Date
  snippet: string | null
  start_seconds: number | string | null
  end_seconds: number | string | null
  match_type: SearchHit["matchType"]
  score: number | string
  similarity: number | string | null
}

const CANDIDATE_LIMIT = 100
const RRF_K = 60
const HEADLINE_OPTS = `StartSel=${SNIPPET_START}, StopSel=${SNIPPET_END}, MaxFragments=2, MinWords=5, MaxWords=24, FragmentDelimiter= … `

function normalizeOptions(options: SearchOptions) {
  return {
    limit: Math.max(
      1,
      Math.min(
        Math.trunc(options.limit ?? SEARCH_DEFAULT_LIMIT),
        SEARCH_MAX_LIMIT
      )
    ),
    offset: Math.max(
      0,
      Math.min(Math.trunc(options.offset ?? 0), SEARCH_MAX_OFFSET)
    ),
  }
}

function toHit(row: SearchRow): SearchHit {
  return {
    passageId: row.passage_id,
    recordingId: row.recording_id,
    title: row.title,
    createdAt: new Date(row.created_at),
    snippet: renderSnippet(row.snippet ?? ""),
    matchType: row.match_type,
    startSeconds: row.start_seconds === null ? null : Number(row.start_seconds),
    endSeconds: row.end_seconds === null ? null : Number(row.end_seconds),
    score: Number(row.score),
    similarity: row.similarity === null ? null : Number(row.similarity),
  }
}

function pageRows(
  rows: SearchRow[],
  limit: number,
  offset: number
): SearchPage {
  return {
    results: rows.slice(0, limit).map(toHit),
    pagination: { limit, offset, hasMore: rows.length > limit },
  }
}

async function keywordSearch(
  ownerId: string,
  query: string,
  limit: number,
  offset: number
): Promise<SearchPage> {
  const model = config.embeddingModel()
  const rows = (await db.execute(sql`
    WITH eligible AS (
      SELECT embedding.id AS passage_id,
             embedding.recording_id,
             recording.title,
             recording.created_at,
             embedding.content,
             embedding.search_vector,
             embedding.start_seconds,
             embedding.end_seconds
      FROM transcript_embeddings embedding
      JOIN recordings recording ON recording.id = embedding.recording_id
      WHERE embedding.owner_id = ${ownerId}
        AND embedding.embedding_model = ${model}
        AND embedding.embedding_version IN (${SEARCH_EMBEDDING_VERSION}, ${LEGACY_SEARCH_EMBEDDING_VERSION})
        AND embedding.transcription_id = (
          SELECT transcription.id
          FROM transcriptions transcription
          WHERE transcription.recording_id = embedding.recording_id
          ORDER BY transcription.created_at DESC
          LIMIT 1
        )
    ), ranked AS (
      SELECT eligible.*,
             ts_rank(eligible.search_vector, websearch_to_tsquery('simple', ${query})) AS keyword_score,
             row_number() OVER (
               ORDER BY ts_rank(eligible.search_vector, websearch_to_tsquery('simple', ${query})) DESC,
                        eligible.passage_id
             ) AS keyword_rank
      FROM eligible
      WHERE eligible.search_vector @@ websearch_to_tsquery('simple', ${query})
      ORDER BY keyword_score DESC, eligible.passage_id
      LIMIT ${CANDIDATE_LIMIT}
    ), capped AS (
      SELECT ranked.*,
             row_number() OVER (
               PARTITION BY recording_id
               ORDER BY keyword_rank, passage_id
             ) AS recording_rank
      FROM ranked
    )
    SELECT passage_id,
           recording_id,
           title,
           created_at,
           ts_headline('simple', content, websearch_to_tsquery('simple', ${query}), ${HEADLINE_OPTS}) AS snippet,
           start_seconds,
           end_seconds,
           'keyword' AS match_type,
           1.0 / (${RRF_K} + keyword_rank) AS score,
           NULL::double precision AS similarity
    FROM capped
    WHERE recording_rank <= 3
    ORDER BY keyword_rank, created_at DESC, passage_id
    LIMIT ${limit + 1}
    OFFSET ${offset}
  `)) as unknown as SearchRow[]
  return pageRows(rows, limit, offset)
}

async function hybridSearch(
  ownerId: string,
  query: string,
  queryEmbedding: number[],
  limit: number,
  offset: number
): Promise<SearchPage> {
  const model = config.embeddingModel()
  const vectorValue = JSON.stringify(queryEmbedding)
  const rows = (await db.execute(sql`
    WITH eligible AS (
      SELECT embedding.id AS passage_id,
             embedding.recording_id,
             recording.title,
             recording.created_at,
             embedding.content,
             embedding.search_vector,
             embedding.start_seconds,
             embedding.end_seconds,
             embedding.embedding
      FROM transcript_embeddings embedding
      JOIN recordings recording ON recording.id = embedding.recording_id
      WHERE embedding.owner_id = ${ownerId}
        AND embedding.embedding_model = ${model}
        AND embedding.embedding_version IN (${SEARCH_EMBEDDING_VERSION}, ${LEGACY_SEARCH_EMBEDDING_VERSION})
        AND embedding.transcription_id = (
          SELECT transcription.id
          FROM transcriptions transcription
          WHERE transcription.recording_id = embedding.recording_id
          ORDER BY transcription.created_at DESC
          LIMIT 1
        )
    ), semantic_candidates AS (
      SELECT passage_id,
             row_number() OVER (
               ORDER BY embedding <=> ${vectorValue}::vector, passage_id
             ) AS semantic_rank,
             1 - (embedding <=> ${vectorValue}::vector) AS similarity
      FROM eligible
      WHERE 1 - (embedding <=> ${vectorValue}::vector) >= 0.2
      ORDER BY embedding <=> ${vectorValue}::vector, passage_id
      LIMIT ${CANDIDATE_LIMIT}
    ), keyword_candidates AS (
      SELECT passage_id,
             row_number() OVER (
               ORDER BY ts_rank(search_vector, websearch_to_tsquery('simple', ${query})) DESC,
                        passage_id
             ) AS keyword_rank
      FROM eligible
      WHERE search_vector @@ websearch_to_tsquery('simple', ${query})
      ORDER BY ts_rank(search_vector, websearch_to_tsquery('simple', ${query})) DESC,
               passage_id
      LIMIT ${CANDIDATE_LIMIT}
    ), candidate_scores AS (
      SELECT passage_id,
             semantic_rank,
             NULL::bigint AS keyword_rank,
             similarity,
             1.0 / (${RRF_K} + semantic_rank) AS score
      FROM semantic_candidates
      UNION ALL
      SELECT passage_id,
             NULL::bigint AS semantic_rank,
             keyword_rank,
             NULL::double precision AS similarity,
             1.0 / (${RRF_K} + keyword_rank) AS score
      FROM keyword_candidates
    ), fused AS (
      SELECT passage_id,
             min(semantic_rank) AS semantic_rank,
             min(keyword_rank) AS keyword_rank,
             max(similarity) AS similarity,
             sum(score) AS score
      FROM candidate_scores
      GROUP BY passage_id
    ), ranked_fused AS (
      SELECT fused.*,
             eligible.recording_id,
             row_number() OVER (
               PARTITION BY eligible.recording_id
               ORDER BY fused.score DESC, fused.passage_id
             ) AS recording_rank
      FROM fused
      JOIN eligible ON eligible.passage_id = fused.passage_id
    )
    SELECT eligible.passage_id,
           eligible.recording_id,
           eligible.title,
           eligible.created_at,
           CASE
             WHEN ranked_fused.keyword_rank IS NULL THEN eligible.content
             ELSE ts_headline('simple', eligible.content, websearch_to_tsquery('simple', ${query}), ${HEADLINE_OPTS})
           END AS snippet,
           eligible.start_seconds,
           eligible.end_seconds,
           CASE
             WHEN ranked_fused.semantic_rank IS NOT NULL AND ranked_fused.keyword_rank IS NOT NULL THEN 'hybrid'
             WHEN ranked_fused.keyword_rank IS NOT NULL THEN 'keyword'
             ELSE 'semantic'
           END AS match_type,
           ranked_fused.score,
           ranked_fused.similarity
    FROM ranked_fused
    JOIN eligible ON eligible.passage_id = ranked_fused.passage_id
    WHERE ranked_fused.recording_rank <= 3
    ORDER BY ranked_fused.score DESC, eligible.created_at DESC, eligible.passage_id
    LIMIT ${limit + 1}
    OFFSET ${offset}
  `)) as unknown as SearchRow[]
  return pageRows(rows, limit, offset)
}

export async function searchRecordings(
  ownerId: string,
  q: string,
  options: SearchOptions = {}
): Promise<SearchPage> {
  const query = q.trim()
  const { limit, offset } = normalizeOptions(options)
  if (!query) {
    return { results: [], pagination: { limit, offset, hasMore: false } }
  }

  if (!config.semanticSearchEnabled()) {
    return keywordSearch(ownerId, query, limit, offset)
  }

  try {
    const queryEmbedding = await embedSearchQuery(query)
    return await hybridSearch(ownerId, query, queryEmbedding, limit, offset)
  } catch (error) {
    console.error(
      "[search] semantic search unavailable",
      error instanceof Error ? error.message : String(error)
    )
    return keywordSearch(ownerId, query, limit, offset)
  }
}
