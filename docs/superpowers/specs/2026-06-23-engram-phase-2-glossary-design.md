# Engram — Phase 2 Design: Glossary / Custom Vocabulary

**Date:** 2026-06-23
**Status:** Approved design, pre-implementation
**Scope:** The first Phase 2 slice. Phase 2 is a cluster of independent features (glossary, speaker naming, multi-view summaries + templates, Ask-Engram RAG); this spec covers only the **glossary / custom vocabulary**. Each other slice gets its own spec→plan→build cycle.

## Goal

Let the single user maintain a glossary of their own terms — Belgian-tech jargon, product names, people's names — and have it improve transcription and summaries: bias Scribe toward correct spellings up front, deterministically fix known mis-hearings afterward, and make summaries use the right terms. Foundational quality that flows into every later slice (search, RAG).

## Locked decisions

| Area | Decision |
|---|---|
| Entry shape | `term` (canonical) + `aliases` (`string[]`, common mis-spellings/mis-hearings). Single-user, global glossary. |
| Scribe keyterms | **Included.** Canonical terms passed as Scribe's `keyterms` param to bias transcription up front. Confirmed supported on `scribe_v2` (array of strings; ≤50 chars, ≤5 words each, no `<>{}[]\`, ≤1000 terms; **using it adds ~20% to transcription cost**). |
| Alias correction | Deterministic, **word-boundary-aware + case-insensitive** replace of aliases → canonical, applied to the transcript after Scribe. No LLM. Free. |
| Summary injection | The glossary's canonical terms are injected into the enhance system prompt so summaries spell terms correctly. ≈free. |
| Empty-glossary | **Total no-op** — no `keyterms` sent (so no +20% cost), no correction, no prompt block. Zero behavior change until terms exist. |
| Lossless | Raw Scribe output stays in `transcriptions.raw`; correction only changes `fullText` + `segments`. |
| Application window | New recordings going forward. Re-processing existing recordings is out of scope (would cost a re-transcribe). |
| Management UI | A "Glossary" section in the existing Settings page (CRUD). |

## Data model

New additive table (no change to existing tables):
- `glossary` — `id` (uuid pk), `term` (text, not null), `aliases` (jsonb `string[]`, default `[]`), `createdAt` (timestamp). One migration.

## Architecture / data flow

```
Settings → Glossary section (add/edit/delete) ──▶ glossary table
                                                     │
upload or Plaud sync → runTranscription:
  load glossary entries
  → toKeyterms(entries) → (if non-empty) pass as Scribe `keyterms`     [bias up front, +20% cost only when non-empty]
  → Scribe returns text + segments
  → applyAliasCorrections() on fullText AND each segment.text          [deterministic alias→canonical]
  → store transcription (raw Scribe JSON kept in `raw`)
runEnhancement:
  load glossary → glossaryPromptBlock(entries) appended to the enhance system prompt → store summary
```

## Components (modular, one responsibility each)

1. **`lib/glossary/store.ts`** — Drizzle CRUD: `getGlossary(): Promise<GlossaryEntry[]>`, `addEntry({term, aliases})`, `updateEntry(id, {term, aliases})`, `deleteEntry(id)`. `GlossaryEntry = { id; term; aliases: string[]; createdAt }`.
2. **`lib/glossary/apply.ts`** — pure, no IO (the testable core):
   - `toKeyterms(entries): string[]` — canonical terms, sanitized to Scribe limits (≤50 chars, ≤5 words after whitespace-normalization, strip `<>{}[]\`, drop empties, dedupe, cap 1000).
   - `applyAliasCorrections(text, entries): string` — for each entry, replace each alias with the canonical term using a word-boundary, case-insensitive match; must NOT corrupt substrings (alias "AI" leaves "again" untouched); output uses the canonical casing. Longer aliases applied before shorter to avoid partial overlaps.
   - `glossaryPromptBlock(entries): string` — formats canonical terms (with notable aliases) for the LLM prompt; returns `""` for an empty glossary.
3. **`lib/transcription/scribe.ts`** — add `keyterms?: string[]` to `ScribeOptions`; when present and non-empty, append to the request form. (Exact multipart encoding — JSON string vs. repeated fields — verified against ElevenLabs docs/live during the build.)
4. **`lib/ai/enhance.ts`** — `enhanceTranscript(transcript, opts?)` gains an optional `glossaryBlock?: string`; when non-empty, appended to the system prompt (e.g. "Gebruik de correcte spelling voor deze termen/namen: …"). Keeps Dutch output.
5. **`lib/pipeline.ts`** — `runTranscription` loads the glossary, passes `toKeyterms(...)` to Scribe, runs `applyAliasCorrections` on the result before insert. `runEnhancement` loads the glossary and passes `glossaryPromptBlock(...)` to `enhanceTranscript`.
6. **API routes** (session-guarded): `app/api/glossary/route.ts` (`GET` list, `POST` create), `app/api/glossary/[id]/route.ts` (`PATCH` update, `DELETE`).
7. **Settings UI** — a "Glossary" section in `app/settings/page.tsx`: list entries, an add form (term + comma-separated aliases), edit, delete. A small `"use client"` component; English UI.

## Security

- All glossary API routes session-guarded (`auth.api.getSession`), same pattern as the other data routes. Single-user; no per-user scoping needed.
- Glossary content isn't secret, but is only readable/writable behind login.

## Error handling

- Empty/whitespace term rejected (400) on create/update.
- `toKeyterms` silently drops entries that violate Scribe constraints (logged count) rather than failing the transcription.
- Scribe `keyterms` only sent when non-empty → no cost or API change for an empty glossary.
- Alias correction is pure string work; a malformed entry can't throw the pipeline (guarded).
- Glossary load failure in the pipeline degrades gracefully: transcription/enhancement proceed without the glossary (logged), never blocked.

## Testing

- **`lib/glossary/apply.ts`** (primary): `toKeyterms` sanitization (length/word/char/dedupe/cap); `applyAliasCorrections` (word-boundary, case-insensitive, canonical casing, no substring corruption — explicit "AI" vs "again" test, multiple entries, longer-alias-first); `glossaryPromptBlock` (formatting + empty case).
- **`lib/glossary/store.ts`**: light CRUD test with a mocked db.
- **`lib/transcription/scribe.ts`**: keyterms appear in the request when provided, absent when not (mocked fetch).
- **Pipeline tests**: extend the existing `@/db` mock so `db.query.glossary.findMany` returns `[]`, keeping current pipeline tests green; the empty-glossary no-op path is covered.
- `pnpm exec tsc --noEmit` clean; full suite green.

## Out of scope (later)

- Re-processing existing recordings against an updated glossary (a per-recording "re-transcribe" action).
- Categories/grouping, glossary import/export, per-recording or per-speaker glossaries.
- The other Phase 2 slices (speaker naming, multi-view summaries + templates, RAG).

## Task order (drives the plan + PROGRESS)

1. `glossary` table + migration; `lib/glossary/store.ts` (CRUD) + light test.
2. `lib/glossary/apply.ts` (`toKeyterms`, `applyAliasCorrections`, `glossaryPromptBlock`) + thorough unit tests.
3. Scribe `keyterms` option (+ test, verify multipart encoding).
4. Wire the pipeline: keyterms + alias correction in `runTranscription`; prompt block in `runEnhancement` + `enhance.ts` (update pipeline-test db mock).
5. Glossary API routes (GET/POST, PATCH/DELETE), session-guarded.
6. Settings "Glossary" CRUD UI section.
7. Docs: note the +20% keyterms cost in DEPLOY.md/PROGRESS; mark this Phase 2 slice.
