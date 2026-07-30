import { sql } from "drizzle-orm"
import { db } from "@/db"
import { renderPlainSnippet, SNIPPET_END, SNIPPET_START } from "./snippet"

export type GeneratedNoteSource =
  | "overview"
  | "key_point"
  | "decision"
  | "action_item"
  | "chapter"
  | "open_question"

export type GeneratedNoteHit = {
  evidenceId: string
  recordingId: string
  title: string
  createdAt: Date
  snippet: string
  source: GeneratedNoteSource
  startSeconds: number | null
  score: number
}

type GeneratedNoteRow = {
  evidence_id: string
  recording_id: string
  title: string
  created_at: string | Date
  snippet: string
  source: GeneratedNoteSource
  start_seconds: number | string | null
  score: number | string
}

const HEADLINE_OPTIONS = `StartSel=${SNIPPET_START}, StopSel=${SNIPPET_END}, MaxFragments=1, MinWords=4, MaxWords=30`

export async function searchGeneratedNotes(
  ownerId: string,
  query: string,
  options: { limit?: number } = {}
): Promise<GeneratedNoteHit[]> {
  const trimmed = query.trim()
  if (!trimmed) return []
  const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 12), 50))

  const rows = (await db.execute(sql`
    WITH latest_enhancements AS (
      SELECT DISTINCT ON (enhancement.recording_id)
             enhancement.*,
             recording.title AS recording_title,
             recording.created_at AS recording_created_at
      FROM ai_enhancements enhancement
      JOIN recordings recording ON recording.id = enhancement.recording_id
      WHERE recording.owner_id = ${ownerId}
      ORDER BY enhancement.recording_id,
               enhancement.created_at DESC,
               enhancement.id DESC
    ), eligible AS (
      SELECT *
      FROM latest_enhancements enhancement
      WHERE enhancement.search_vector @@ websearch_to_tsquery('simple', ${trimmed})
    ), matches AS (
      SELECT enhancement.id || ':' || evidence.source || ':' || evidence.position AS evidence_id,
             enhancement.recording_id,
             enhancement.recording_title AS title,
             enhancement.recording_created_at AS created_at,
             evidence.content,
             evidence.source,
             evidence.start_seconds,
             evidence.weight * ts_rank(
               to_tsvector('simple', evidence.content),
               websearch_to_tsquery('simple', ${trimmed})
             ) AS score
      FROM eligible enhancement
      CROSS JOIN LATERAL (
        SELECT 'overview'::text AS source,
               enhancement.overview AS content,
               NULL::double precision AS start_seconds,
               0::bigint AS position,
               1.3::double precision AS weight
        UNION ALL
        SELECT 'key_point', item.value, NULL::double precision, item.position, 1.1
        FROM jsonb_array_elements_text(enhancement.key_points)
             WITH ORDINALITY AS item(value, position)
        UNION ALL
        SELECT 'decision', item.value, NULL::double precision, item.position, 1.4
        FROM jsonb_array_elements_text(enhancement.decisions)
             WITH ORDINALITY AS item(value, position)
        UNION ALL
        SELECT 'action_item',
               concat_ws(' — ',
                 item.value ->> 'text',
                 CASE WHEN nullif(item.value ->> 'owner', '') IS NOT NULL
                   THEN 'Owner: ' || (item.value ->> 'owner') END,
                 CASE WHEN nullif(item.value ->> 'due', '') IS NOT NULL
                   THEN 'Due: ' || (item.value ->> 'due') END
               ),
               NULL::double precision,
               item.position,
               1.4
        FROM jsonb_array_elements(enhancement.action_items)
             WITH ORDINALITY AS item(value, position)
        UNION ALL
        SELECT 'chapter',
               concat_ws(' — ', item.value ->> 'title', item.value ->> 'gist'),
               CASE WHEN jsonb_typeof(item.value -> 'startSeconds') = 'number'
                 THEN (item.value ->> 'startSeconds')::double precision
                 ELSE NULL::double precision END,
               item.position,
               1.0
        FROM jsonb_array_elements(enhancement.chapters)
             WITH ORDINALITY AS item(value, position)
        UNION ALL
        SELECT 'open_question', item.value, NULL::double precision, item.position, 0.9
        FROM jsonb_array_elements_text(enhancement.open_questions)
             WITH ORDINALITY AS item(value, position)
      ) evidence
      WHERE to_tsvector('simple', evidence.content)
            @@ websearch_to_tsquery('simple', ${trimmed})
    )
    SELECT evidence_id,
           recording_id,
           title,
           created_at,
           ts_headline(
             'simple',
             content,
             websearch_to_tsquery('simple', ${trimmed}),
             ${HEADLINE_OPTIONS}
           ) AS snippet,
           source,
           start_seconds,
           score
    FROM matches
    ORDER BY score DESC, created_at DESC, evidence_id
    LIMIT ${limit}
  `)) as unknown as GeneratedNoteRow[]

  return rows.map((row) => ({
    evidenceId: row.evidence_id,
    recordingId: row.recording_id,
    title: row.title,
    createdAt: new Date(row.created_at),
    snippet: renderPlainSnippet(row.snippet),
    source: row.source,
    startSeconds: row.start_seconds === null ? null : Number(row.start_seconds),
    score: Number(row.score),
  }))
}
