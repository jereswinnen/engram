# Engram — Phase 2 Design: Rich AI Enhancement + Speaker Naming

**Date:** 2026-06-23
**Status:** Approved design, pre-implementation
**Scope:** First Phase 2 (AI layer) sub-project. Covers (a) a richer, Plaud-grade AI enhancement and (b) speaker naming with a reusable directory. **Out of scope (later, own specs):** multi-view summaries/templates, mind maps, Ask-Engram (RAG). Vocabulary/glossary already shipped (Phase 2 slice 1).

## Goal

Produce a great, structured AI enhancement (overview, key points, decisions, owner-attributed action items, timestamped chapters, open questions) and let the user name diarized speakers via a reusable directory — so summaries and action items read like Plaud's, with real names and chapters that tie into the waveform.

## Locked decisions

| Area | Decision |
|---|---|
| Speaker identity | **Name-based**, not voice-based (Scribe gives anonymous per-recording `Speaker N`; no voiceprints). A reusable **directory** + per-recording label→speaker mapping. Manual rename only (no LLM auto-suggest, no Plaud-name porting). |
| Naming is non-destructive | Scribe segments keep their original `speaker` label; names are substituted at read time via the mapping. Reversible. |
| Enhancement output | `title`, `overview`, `keyPoints[]`, `decisions[]`, `actionItems[{text, owner?, due?}]`, `chapters[{title, gist, startSeconds?}]`, `openQuestions[]`. |
| Action-item owners | The named speaker (or `Speaker N` until named). `due` = as stated in the conversation (free text; not normalized). |
| Chapters | `startSeconds` (LLM-estimated from the timestamped transcript) → clickable, seeks the waveform (reuses `setTime`). |
| Language | **Always English** (flip the current Dutch system prompt to English). |
| Model | **Configurable** via existing env (`config.llmModel()`); default unchanged. No new model wiring. |
| Regeneration | First-class: initial run after transcription (anonymous owners) + a manual **Regenerate** button; offered (hint) after renaming speakers. Manual, never auto-on-rename. |

## Data model (one migration)

- **`speakers`** — the directory: `id` (uuid pk), `name` (text, unique), `createdAt`. Single-user; no owner column.
- **`recordingSpeakers`** — per-recording assignment: `id`, `recordingId` (fk → recordings, cascade), `label` (text, e.g. `"Speaker 1"`), `speakerId` (fk → speakers), `createdAt`; **unique `(recordingId, label)`**.
- **`aiEnhancements`** (extend): `summary` → **`overview`** (text, rename); `actionItems` jsonb changes from `string[]` to `{ text: string; owner?: string; due?: string }[]`; add `decisions` jsonb `string[]`, `chapters` jsonb `{ title: string; gist: string; startSeconds?: number }[]`, `openQuestions` jsonb `string[]`. Keep `title`, `keyPoints`, `model`, `kind`. Existing rows are regenerated (personal app — no data migration of old content needed; the migration may drop/replace the changed columns).

## Architecture / data flow

```
Transcribe (Scribe) → segments [{start,end,text,speaker:"Speaker N"}]  (unchanged)

runEnhancement(recordingId):
  map = recordingSpeakers for recording → { "Speaker 1": "Bjorn", ... }   (empty on first run)
  namedTranscript = buildNamedTranscript(segments, map)   // "[mm:ss] Bjorn: …" lines
  enhancement = generateObject(richSchema, englishSystemPrompt, namedTranscript)  // model = config.llmModel()
  store enhancement (overview/keyPoints/decisions/actionItems/chapters/openQuestions)

Rename on detail page:
  "Speaker 1" → "Bjorn"  → findOrCreateSpeaker("Bjorn") + upsert recordingSpeakers(recId,"Speaker 1",speakerId)
  → directory autocompletes from speakers; transcript/exports/summary substitute names at read time
  → hint: "names changed — Regenerate" → POST regenerate → runEnhancement again (now owners = names)

Detail page render:
  Enhancement sections (Overview/Key points/Decisions/Action items[owner,due]/Chapters/Open questions)
  Chapters: click → wavesurfer.setTime(startSeconds)   (guard: only if 0 ≤ startSeconds ≤ duration)
  Transcript speaker labels: inline-editable with directory autocomplete
```

## Components (modular)

1. **`lib/ai/schema.ts`** — replace `enhancementSchema`/`Enhancement` with the rich Zod schema above. Pure; unit-tested (valid/invalid shapes, optional fields).
2. **`lib/ai/enhance.ts`** — English system prompt; `generateObject(richSchema)`; keep `glossaryBlock` support; accept the named+timestamped transcript. Model via `config.llmModel()` (unchanged).
3. **`lib/transcript/speaker-names.ts`** (pure) — `nameForLabel(label: string, map: Record<string,string>): string` (falls back to the label); `buildNamedTranscript(segments, map): string` (`[mm:ss] {name}: {text}` lines for the prompt). Unit-tested.
4. **`lib/speakers/store.ts`** — `findOrCreateSpeaker(name)`, `listSpeakers()` (directory/autocomplete), `getRecordingSpeakerMap(recordingId)` → `Record<label,name>`, `setRecordingSpeaker(recordingId, label, name)` (find-or-create + upsert; empty name → delete mapping). Light tests (mocked db).
5. **DB:** `speakers` + `recordingSpeakers` tables + `aiEnhancements` changes + migration.
6. **`lib/pipeline.ts`** (`runEnhancement`) — build the named transcript via the map + the new schema; store the rich fields. Re-runnable (regenerate replaces the latest enhancement row for the recording).
7. **API:** `PUT /api/recordings/[id]/speakers` (set a label→name); `POST /api/recordings/[id]/regenerate` (re-run enhancement). Session-guarded. `GET` directory for autocomplete (or load server-side).
8. **UI (detail page):** rich enhancement sections; chapters→seek (extend `TranscriptPlayer` with a `seekTo(seconds)` handle or a chapters list that calls it); inline speaker rename with autocomplete; Regenerate button + the post-rename hint.
9. **Exports:** `lib/export/markdown.ts` + `json.ts` extended for the richer fields + resolved speaker names (and the per-recording map passed in).

## Error handling

- Enhancement failure/timeout → recording `status: 'error'`, retryable via **Regenerate** (existing pipeline error pattern). `generateObject` + Zod auto-retries on schema mismatch.
- Renaming: empty/blank name clears the mapping (label shown again). Find-or-create dedupes by name (case-insensitive trim).
- Chapter `startSeconds` missing or outside `[0, duration]` → chapter still shown, not seekable (guard in the click handler).
- A recording with no transcription yet → no enhancement/speaker UI (existing processing state).
- Regenerate replaces the recording's enhancement (no duplicate rows).

## Testing

- **`lib/ai/schema.ts`** — rich schema accepts a full object; rejects malformed (e.g. actionItem without `text`); optional `owner`/`due`/`startSeconds` allowed absent.
- **`lib/transcript/speaker-names.ts`** — `nameForLabel` (mapped → name; unmapped → label; empty map → label); `buildNamedTranscript` (substitutes names, keeps `[mm:ss]`, anonymous when no map).
- **`lib/speakers/store.ts`** — find-or-create dedupes by normalized name; `setRecordingSpeaker` upserts; empty name deletes; `getRecordingSpeakerMap` returns label→name.
- **`lib/ai/enhance.ts`** — mocked model: asserts the English system prompt + rich schema are wired and `glossaryBlock` is included; LLM output not asserted.
- **Exports** — markdown/json include the new fields + resolved names (extend existing serializer tests).
- Pipeline, API routes (auth + regenerate), and UI/seek verified by `pnpm exec tsc --noEmit` + manual run.

## Plan sequencing (drives the plan + PROGRESS)

Ship the rich enhancement first (works with anonymous owners), then layer naming + regenerate:
1. Rich enhancement Zod schema + English prompt in `enhance.ts` + tests.
2. `aiEnhancements` migration (overview rename + structured actionItems + decisions/chapters/openQuestions).
3. `runEnhancement` produces + stores the rich enhancement (anonymous owners); detail page renders the new sections; chapters→waveform seek.
4. `speakers` + `recordingSpeakers` tables + `lib/speakers/store.ts` + `speaker-names.ts` helpers + tests.
5. Inline speaker rename UI (directory autocomplete) + `PUT …/speakers`; transcript/display substitute names.
6. Regenerate (`POST …/regenerate`) + post-rename hint; owners become real names.
7. Extend MD/JSON exports for the richer fields + names.
8. Docs/PROGRESS.
