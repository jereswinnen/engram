# Semantic transcript search rollout

This rollout is additive: recordings and transcript source rows are never updated
or deleted. Embeddings live in their own derived-data table and can be regenerated
from the original transcripts at any time.

## Phase 1 — foundation

- [x] Reuse the existing Railway `OPENAI_API_KEY`; do not copy it locally.
- [x] Use OpenAI `text-embedding-3-small` (1,536 dimensions) by default.
- [x] Add timestamp-aware, overlapping transcript chunking.
- [x] Add an idempotent `transcript_embeddings` schema.
- [x] Enable PostgreSQL `vector` 0.8.4 in Railway.
- [x] Apply the additive migration in production.

## Phase 2 — generation and backfill

- [x] Generate embeddings automatically for newly transcribed recordings.
- [x] Add a dry-run capable, resumable backfill command.
- [x] Backfill all 39 non-empty existing transcripts in small batches.
- [x] Verify zero searchable transcripts are missing embeddings.

## Phase 3 — shared semantic search

- [x] Add owner-scoped vector retrieval with keyword fallback.
- [x] Add an OAuth/session-protected `/api/search` endpoint for web, iOS, and MCP.
- [x] Upgrade the web search results with semantic snippets and timestamps.
- [x] Add isolation, API, and search behavior tests.

## Phase 4 — rollout verification

- [x] Run all 206 tests, TypeScript, changed-file lint, and the production build.
- [ ] Resolve the repository's pre-existing full-lint baseline (75 unrelated errors).
- [x] Deploy and observe a terminal Railway `SUCCESS` state.
- [x] Verify a production OpenAI vector query returns timestamped results.
- [x] Confirm embedding ownership matches recording ownership for every row.
- [x] Record the embedding coverage audit and rollback procedure.

## Phase 5 — search quality foundation

These changes prepare the shared search contract for web, iOS, and MCP. A result is
a citation-ready transcript passage with a recording ID and timestamp, rather than
only a recording-level match.

- [x] Version enriched embeddings so a rebuild is explicit and resumable.
- [x] Include recording titles, generated summaries, and resolved speaker names in
  the text used for retrieval.
- [x] Fuse exact keyword and semantic passage ranks using reciprocal-rank fusion.
- [x] Cap each recording at three passages so one long transcript cannot crowd out
  all other recordings.
- [x] Add a versioned, paginated `/api/search` response shared by future clients.
- [x] Group up to three timestamped passages beneath each recording in web search.
- [x] Refresh derived embeddings after enhancement or speaker-name changes.
- [x] Add a local evaluation harness for recall@3, recall@5, and reciprocal rank.
- [x] Apply the additive v2 migration in production.
- [x] Rebuild all non-empty transcript embeddings and verify coverage.
- [ ] Run the first private search evaluation and record aggregate results.

The migration keeps v1 rows readable throughout the rebuild. Each recording is
switched to v2 in one transaction, and obsolete derived chunks are removed only
after the replacement chunks have been written successfully.

## Rollback

Set `SEMANTIC_SEARCH_ENABLED=false` to return immediately to the existing PostgreSQL
full-text search. Keep the additive table and `vector` extension in place; neither
affects recordings, transcripts, audio, or the legacy full-text index. Do not drop
the table or extension during the rollout window.

## Commands

After the extension and migration are present, inspect a small batch without calling
OpenAI or writing rows:

```bash
pnpm search:backfill -- --dry-run --limit 10
```

Embed up to ten recordings per resumable batch:

```bash
pnpm search:backfill -- --limit 10
```

Repeat until the command reports zero candidates. A recording's chunks are written
in one transaction, so a failed batch cannot leave a partial recording indexed.

Create a private evaluation dataset by copying `evals/search-cases.example.json`.
Use natural questions you genuinely remember asking, then associate each with the
recording ID that should answer it. Do not commit the private dataset.

```bash
pnpm search:evaluate -- --dataset /path/to/private-search-cases.json --owner-id USER_ID
```

The report prints aggregate metrics and failed case IDs only. It does not print or
persist query text, transcript text, or search snippets.

## Phase 5 production verification — 2026-07-25

- Railway deployment `270a77a2-fab8-43b7-9753-6cebdc68b18a`: `SUCCESS`.
- 38 latest transcripts; 37 non-empty and searchable; zero missing v2 embeddings.
- 837 v2 passages across 37 recordings; zero v1 rows remain.
- Zero incorrect vector dimensions, missing generated search vectors, or owner
  mismatches.
- A generic semantic smoke query returned 10 timestamped passages across five
  recordings through the production search implementation.

The first qualitative evaluation remains intentionally unchecked. Its questions
should either be written from the user's own memory or be generated from private
recording summaries only after explicit approval for that additional OpenAI use.
