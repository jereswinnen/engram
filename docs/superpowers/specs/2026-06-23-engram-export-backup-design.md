# Engram — Phase 1+ Design: Export & Backup

**Date:** 2026-06-23
**Status:** Approved design, pre-implementation
**Scope:** Third and final Phase 1+ UX slice (waveform ✅ → search ✅ → **export & backup**). After this, work moves to the Phase 2 AI layer.

## Goal

Let the user get their data out: per-recording **Markdown** (Notion-friendly) and **JSON** export, plus a one-click **full backup** — an async-generated zip of all recordings (audio + transcript + summary) downloadable when ready.

## Locked decisions

| Area | Decision |
|---|---|
| Notion | **Notion-flavored Markdown** (download + copy-to-clipboard). No Notion API/integration. |
| Per-recording formats | **MD** (Notion-friendly) and **JSON**, via a download route + detail-page buttons (+ copy-MD). |
| Full backup contents | **Data + audio**, as a zip (per-recording folder: audio + `transcript.md` + `data.json`) + top-level `manifest.json`. |
| Full backup execution | **Async, fire-and-forget** job on the persistent Railway container (same pattern as the sync pipeline). Tracked in a `backups` table; the zip is stored in R2; downloaded via a presigned URL when `ready`. |
| Backup resilience | Per-recording failures (e.g. missing audio in R2) are skipped + noted in the manifest; the backup still completes. Only a wholesale failure → `status='error'`. |
| Streaming | Zip built with `archiver` (streamed); uploaded to R2 via streaming multipart (`@aws-sdk/lib-storage`). A `putStream` is added to the storage interface. |
| UI | Detail-page export buttons; a "Backups" section in Settings (create + list + status + download; light polling while `pending`). |
| Security | All routes session-guarded; backup zip via short-TTL presigned URL. |

## Data model

New additive table (no change to existing tables):
- `backups` — `id` (uuid pk), `status` (text: `pending`/`ready`/`error`, default `pending`), `storageKey` (text, nullable — set when ready), `sizeBytes` (integer, nullable), `error` (text, nullable), `createdAt` (timestamp). One migration.

## Architecture / data flow

```
Part A (sync):
  Detail page → "Download .md" / ".json" → GET /api/recordings/{id}/export?format=md|json
     → recordingToMarkdown / recordingToExport → file with Content-Disposition attachment
  "Copy Markdown" → client fetches the md export → navigator.clipboard.writeText

Part B (async):
  Settings → "Create backup" → POST /api/backup
     → insert backups row (pending) → fire-and-forget buildBackup(id) → return {id}
  buildBackup(id):
     archiver zip stream; for each recording: stream R2 audio + recordingToMarkdown + recordingToExport JSON
       into recordings/{id}/{audio, transcript.md, data.json}; add manifest.json
     → putStream the zip to R2 (backups/{id}.zip) → update row: status=ready, storageKey, sizeBytes
       (per-recording errors noted in manifest; wholesale failure → status=error, error message)
  Settings list ← GET /api/backup ; Download ← GET /api/backup/{id}/download → presign → redirect
```

## Components (modular)

1. **`lib/export/markdown.ts`** (pure) — `recordingToMarkdown(rec, transcription, enhancement): string`. `# {title}`, a metadata line (date, duration), `## Summary` (or "Not yet processed"), `## Action items` / `## Key points` (bullets, omitted if empty), `## Transcript` (`**Speaker X** [mm:ss]: text` lines; "No transcript yet" if absent). Handles null transcription/enhancement gracefully.
2. **`lib/export/json.ts`** (pure) — `recordingToExport(rec, transcription, enhancement): ExportRecord` (a plain object: `{ id, title, source, createdAt, durationSeconds, status, transcript: {language, fullText, segments} | null, enhancement: {title, summary, actionItems, keyPoints} | null }`). The route `JSON.stringify`s it.
3. **`lib/export/filename.ts`** (pure) — `exportFilename(title, id, ext): string` — a safe download filename (slugify title, fallback to id, append ext). Unit-tested (strips unsafe chars).
4. **`app/api/recordings/[id]/export/route.ts`** — `GET ?format=md|json` (session): load recording+transcription+enhancement; return MD or JSON with `Content-Type` + `Content-Disposition: attachment; filename=…`. 400 on bad format; `notFound` if recording missing.
5. **DB:** `backups` table + migration. `lib/backup/store.ts` — `createBackup()`, `getBackups()`, `markReady(id, key, size)`, `markError(id, msg)`.
6. **`lib/storage/` additions** — `putStream(key, body: Readable, contentType): Promise<void>` on the `Storage` interface + R2 adapter (via `@aws-sdk/lib-storage` `Upload`). Existing `put`/`presignedGetUrl` unchanged.
7. **`lib/backup/build.ts`** — `buildBackup(id)`: the async zip builder (archiver + per-recording entries + manifest + `putStream` + status updates + per-item resilience). Reuses `recordingToMarkdown`/`recordingToExport` + `getStorage()`.
8. **API routes:** `app/api/backup/route.ts` (`POST` create + fire-and-forget; `GET` list), `app/api/backup/[id]/download/route.ts` (`GET` → presign → redirect). All session-guarded.
9. **UI:** `app/recordings/[id]/export-buttons.tsx` (`"use client"`: download links + copy-MD) added to the detail page; `app/settings/backups.tsx` (`"use client"`: create button + backups list + status + download + light polling while pending), rendered by `app/settings/page.tsx` (server loads initial `getBackups()`).

## Error handling

- Export route: invalid `format` → 400; missing recording → `notFound`; a recording with no transcription/enhancement still exports (MD/JSON note "not yet processed").
- `buildBackup`: wrapped so a single recording's audio-fetch failure is caught, recorded in `manifest.json` (`{recordingId, error}`), and skipped; the zip still finalizes. A failure to finalize/upload the zip → `markError(id, msg)`. The fire-and-forget call has an outer `.catch` that marks the row `error` so it never silently hangs in `pending`.
- POST `/api/backup` returns immediately; the build runs after the response (persistent Railway container), so no request timeout.
- Download route: backup not `ready` / no `storageKey` → 409 with a message; ready → presigned redirect.

## Testing

- **`lib/export/markdown.ts`** — full recording → expected MD sections; null enhancement → "not yet processed"; null transcription → "No transcript yet"; empty action items/key points omitted; `[mm:ss]` formatting.
- **`lib/export/json.ts`** — maps to `ExportRecord` with null transcript/enhancement handled.
- **`lib/export/filename.ts`** — slugifies, strips unsafe chars, falls back to id, appends ext.
- **`lib/backup/build.ts`** — orchestration with mocked storage/db/archiver: status `pending`→`ready` on success; per-recording audio failure is skipped (counted) not fatal; wholesale failure → `markError`. (The real archiver+R2 streaming verified at runtime.)
- **Routes** — `export` format/auth gates; `backup` POST auth + returns id; download auth + not-ready → 409.
- `pnpm exec tsc --noEmit` clean; full suite green.

## Out of scope (later)

- Notion API push; scheduled/automatic backups; backup deletion/retention policy (keep all for now; manual prune later); selective/date-range export; the Phase 2 AI layer.

## Task order (drives the plan + PROGRESS)

1. Pure serializers: `markdown.ts`, `json.ts`, `filename.ts` + thorough unit tests.
2. `GET /api/recordings/[id]/export` route + detail-page export buttons (download + copy-MD).
3. `backups` table + migration; `lib/backup/store.ts` (CRUD) + light test.
4. `Storage.putStream` (interface + R2 adapter via `@aws-sdk/lib-storage`); add `archiver`.
5. `lib/backup/build.ts` (`buildBackup`) + orchestration tests (mocked).
6. Backup API routes (`POST`/`GET /api/backup`, `GET /api/backup/[id]/download`) + auth/not-ready tests.
7. Settings "Backups" UI (create + list + status + download + polling).
8. Docs/PROGRESS.
