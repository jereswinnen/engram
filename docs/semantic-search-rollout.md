# Semantic transcript search rollout

This rollout is additive: recordings and transcript source rows are never updated
or deleted. Embeddings live in their own derived-data table and can be regenerated
from the original transcripts at any time.

## Phase 1 — foundation

- [x] Reuse the existing Railway `OPENAI_API_KEY`; do not copy it locally.
- [x] Use OpenAI `text-embedding-3-small` (1,536 dimensions) by default.
- [x] Add timestamp-aware, overlapping transcript chunking.
- [x] Add an idempotent `transcript_embeddings` schema.
- [ ] Enable the PostgreSQL `vector` extension in Railway.
- [ ] Apply the additive migration in production.

## Phase 2 — generation and backfill

- [x] Generate embeddings automatically for newly transcribed recordings.
- [x] Add a dry-run capable, resumable backfill command.
- [ ] Backfill the existing corpus in small batches.
- [ ] Verify every current transcript has embeddings for the configured model.

## Phase 3 — shared semantic search

- [x] Add owner-scoped vector retrieval with keyword fallback.
- [x] Add an OAuth/session-protected `/api/search` endpoint for web, iOS, and MCP.
- [x] Upgrade the web search results with semantic snippets and timestamps.
- [x] Add isolation, API, and search behavior tests.

## Phase 4 — rollout verification

- [x] Run all 206 tests, TypeScript, changed-file lint, and the production build.
- [ ] Resolve the repository's pre-existing full-lint baseline (75 unrelated errors).
- [ ] Deploy and observe a terminal Railway `SUCCESS` state.
- [ ] Verify authenticated web search against an existing transcript.
- [ ] Confirm cross-user transcript results cannot be returned.
- [ ] Record the embedding coverage audit and rollback procedure.

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
