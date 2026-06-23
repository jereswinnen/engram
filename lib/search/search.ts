import { sql } from "drizzle-orm";
import { db } from "@/db";
import { renderSnippet, SNIPPET_START, SNIPPET_END } from "./snippet";

export interface SearchHit {
  id: string;
  title: string;
  createdAt: Date;
  snippet: string;
}

const HEADLINE_OPTS = `StartSel=${SNIPPET_START}, StopSel=${SNIPPET_END}, MaxFragments=2, MinWords=5, MaxWords=18, FragmentDelimiter= … `;

export async function searchRecordings(q: string): Promise<SearchHit[]> {
  const query = q.trim();
  if (!query) return [];

  const rows = (await db.execute(sql`
    SELECT r.id AS id,
           r.title AS title,
           r.created_at AS created_at,
           ts_headline('simple', t.full_text, websearch_to_tsquery('simple', ${query}), ${HEADLINE_OPTS}) AS snippet
    FROM transcriptions t
    JOIN recordings r ON r.id = t.recording_id
    WHERE t.search_vector @@ websearch_to_tsquery('simple', ${query})
       OR to_tsvector('simple', r.title) @@ websearch_to_tsquery('simple', ${query})
    ORDER BY ts_rank(t.search_vector, websearch_to_tsquery('simple', ${query})) DESC
    LIMIT 20
  `)) as unknown as Array<{ id: string; title: string; created_at: string | Date; snippet: string | null }>;

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: new Date(row.created_at),
    snippet: renderSnippet(row.snippet ?? ""),
  }));
}
