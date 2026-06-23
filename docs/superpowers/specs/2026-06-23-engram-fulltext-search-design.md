# Engram — Phase 1+ Design: Full-Text Search

**Date:** 2026-06-23
**Status:** Approved design, pre-implementation
**Scope:** Second of three Phase 1+ UX slices (waveform ✅ → **search** → export). Covers full-text search across recordings only.

## Goal

Search across all recordings' transcripts (and titles) from a `/search` page: ranked results with highlighted snippets, and clicking a result opens the recording and jumps to the first matching transcript segment (reusing the waveform/seek player).

## Locked decisions

| Area | Decision |
|---|---|
| Engine | Postgres full-text search, **`simple`** config (no stemming — safe for mixed Dutch/English; still word-aware). Generated `tsvector` column + **GIN** index. |
| Query parser | `websearch_to_tsquery('simple', q)` — web-style syntax (quoted phrases, `OR`, `-term`). |
| Scope | **Transcript + title.** (Summary/action-items are derived from the transcript, so the transcript already covers them.) |
| Ranking/snippet | `ts_rank` for ordering; `ts_headline` for the highlighted snippet, with **sentinel markers** (not raw HTML) for XSS safety. |
| Results UX | `/search?q=` server page → ranked list (title, date, snippet). Click → `/recordings/{id}?q=…` → detail page jumps to the first matching segment (client-side, reuses the player). |
| Limit | Top ~20 results, ranked. Blank query → empty results (no query run). |
| Data | One additive migration (generated tsvector column + GIN index on `transcriptions`). No pipeline change (generated STORED column stays in sync). |

## Architecture / data flow

```
Header "Search" link → /search page (server, requireSession)
  reads ?q= → searchRecordings(q):
     SELECT r.id, r.title, r.created_at,
            ts_headline('simple', t.full_text, query, '…StartSel=⟦,StopSel=⟧…') AS snippet
     FROM transcriptions t JOIN recordings r ON r.id = t.recording_id,
          websearch_to_tsquery('simple', $q) query
     WHERE t.search_vector @@ query OR to_tsvector('simple', r.title) @@ query
     ORDER BY ts_rank(t.search_vector, query) DESC
     LIMIT 20
  → render search box (client) + results (title, date, sanitized snippet)
Click result → /recordings/{id}?q={term}
  detail page (server) passes q → TranscriptPlayer highlightQuery
  player: firstMatchingSegmentIndex(segments, q) → highlight + scrollIntoView + ws.setTime(seg.start)
```

## Components (modular)

1. **DB (schema + migration):** generated column `transcriptions.searchVector` = `to_tsvector('simple', coalesce(full_text, ''))` STORED, + GIN index `idx_transcriptions_search` on it. Expressed via Drizzle's schema DSL (`customType` for `tsvector` + `.generatedAlwaysAs(sql\`…\`)` + index `.using("gin")`) **if** that compiles cleanly; otherwise a hand-written SQL migration (`drizzle/000N_*.sql`) doing the `ADD COLUMN … GENERATED ALWAYS AS … STORED` + `CREATE INDEX … USING GIN`. Verify the Drizzle DSL against the installed version; don't fight it — fall back to raw SQL and note which was used.
2. **`lib/search/snippet.ts`** (pure) — `renderSnippet(raw: string): string`: HTML-escape the whole string, then replace the sentinel pair (`SNIPPET_START`/`SNIPPET_END`, e.g. `⟦`/`⟧`) with `<mark>`/`</mark>`. Exports the sentinel constants so the SQL and the renderer agree. Guarantees transcript content can't inject HTML.
3. **`lib/search/match.ts`** (pure) — `firstMatchingSegmentIndex(segments: {text: string}[], q: string): number`: index of the first segment whose `text` contains `q` (case-insensitive, trimmed); `-1` for empty `q`/no match. Used by the player for the deep-link jump.
4. **`lib/search/search.ts`** — `searchRecordings(q: string): Promise<SearchHit[]>` (`SearchHit = { id: string; title: string; createdAt: Date; snippet: string }`). Trims `q`; returns `[]` if blank. Runs the FTS query via Drizzle `sql`; maps rows through `renderSnippet`. `session` is enforced by the page, not here.
5. **`app/search/page.tsx`** (server, `requireSession`) — reads `searchParams.q` (Next 16 async), calls `searchRecordings`, renders `<SearchBox initialQuery={q}>` + results (each: link to `/recordings/{id}?q={q}`, title, date, snippet via `dangerouslySetInnerHTML` of the *sanitized* `renderSnippet` output). Empty/blank q → just the box + a hint; no results → "No matches."
6. **`app/search/search-box.tsx`** (`"use client"`) — input + submit → `router.push('/search?q=' + encodeURIComponent(value))`.
7. **`app/layout.tsx`** — add a "Search" nav link (English UI, matching existing nav markup).
8. **`app/recordings/[id]/page.tsx`** — read `searchParams.q` (async), pass `highlightQuery={q}` to `TranscriptPlayer`.
9. **`app/recordings/[id]/transcript-player.tsx`** — accept optional `highlightQuery?: string`; on mount (once segments+ws ready), if present, compute `firstMatchingSegmentIndex(segments, highlightQuery)`, and if ≥0 set it active, `scrollIntoView`, and `wsRef.current?.setTime(seg.start)`.

## Security

- All search behind `requireSession` (the `/search` page; the detail page already guards). No separate unauthenticated API.
- **XSS:** snippets rendered from `ts_headline` go through `renderSnippet` (escape-then-mark via sentinels) before `dangerouslySetInnerHTML`. Never inject raw transcript/headline HTML.
- `q` flows into `websearch_to_tsquery` as a **parameter** (Drizzle `sql` binding), not string-concatenated — no SQL injection. The `?q=` in result links is `encodeURIComponent`'d; the detail page treats it as a plain search string (substring match), not HTML.

## Error handling

- Blank/whitespace `q` → no query, empty results, friendly hint.
- A recording with no transcription row isn't in the join → not searchable until transcribed (acceptable; it has no content). Title-only matches require the transcription row to exist (fine — untranscribed recordings have nothing to find).
- `firstMatchingSegmentIndex` returns `-1` when the term isn't found verbatim in any segment (e.g. FTS matched a stem/title but not a literal substring) → the player just opens normally (no jump), never errors.

## Testing

- **`lib/search/snippet.ts`** — `renderSnippet`: sentinels → `<mark>`; HTML in the source is escaped (explicit `<script>alert(1)</script>` test → no live tag); plain text unchanged; multiple marks.
- **`lib/search/match.ts`** — `firstMatchingSegmentIndex`: found (case-insensitive), not found → `-1`, empty query → `-1`, first-of-multiple.
- **`lib/search/search.ts`** — blank `q` short-circuits to `[]` (no db call); row→`SearchHit` mapping with a mocked db (asserts `renderSnippet` applied). The actual FTS SQL (tsquery/headline/rank) is verified at runtime/manually.
- Pages/player wiring verified by `pnpm exec tsc --noEmit` + manual run.

## Out of scope (later)

- Segment-level result rows (each result = a timestamp); filters (by date/speaker); search-as-you-type/highlight-all-occurrences; the export slice.

## Task order (drives the plan + PROGRESS)

1. `lib/search/snippet.ts` + `lib/search/match.ts` (pure helpers) + thorough unit tests.
2. Schema/migration: `transcriptions.searchVector` generated tsvector + GIN index (Drizzle DSL or raw SQL; `db:generate`, don't apply).
3. `lib/search/search.ts` (`searchRecordings` FTS query) + blank/mapping tests.
4. `/search` page + `search-box.tsx` + header "Search" nav link.
5. Wire the deep-link: detail page passes `?q` → `TranscriptPlayer` jumps to the first matching segment.
6. Docs/PROGRESS.
