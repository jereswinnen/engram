# Engram — Phase 0 Design

**Date:** 2026-06-21
**Status:** Approved design, pre-implementation
**Scope:** Phase 0 only (no Plaud device / MCP sync). See `docs/engram-context.md` for the full project vision and Phases 1–2.

## Goal

Stand up the Engram skeleton end-to-end with **no Plaud device required**. The thing we are proving:

> Upload a Dutch (multi-speaker) audio file → store it durably → get a good diarized transcript → get a good structured summary → view it in a minimal UI, reachable behind a login from any device.

Everything in Phase 0 works against a manually-uploaded sample file. The Plaud MCP sync layer is Phase 1 and is explicitly out of scope here.

## Decisions (locked)

| Area | Decision |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript |
| Package manager | **pnpm** |
| UI kit | shadcn/ui (`pnpm dlx shadcn@latest add <component>`) |
| DB / ORM | PostgreSQL + Drizzle (Railway managed Postgres) |
| Storage | **Cloudflare R2** (S3-compatible), behind a thin storage interface. App stays on Railway; only audio bytes live in R2. |
| Transcription | ElevenLabs **Scribe v2** (batch, diarized) via a hand-written REST adapter (`elevenlabs-provider.ts`). Dutch auto-detect. |
| LLM | **Vercel AI SDK** (`ai` + `@ai-sdk/openai`). Default model `gpt-5.4-mini-2026-03-17`. Provider swappable. |
| Structured output | AI SDK `generateObject` + Zod schema for summary/action-items/key-points. |
| Auth | Better Auth, single user, **added as the LAST Phase 0 task** (only matters at deploy). Email/password **with email verification disabled and no email-based reset** + optional passkey. **No mail provider (no Resend/SMTP) anywhere.** |
| Deploy | Railway: app service + managed Postgres. |
| Progress tracking | `PROGRESS.md` at repo root, kept current. |

## Architecture / data flow (Phase 0)

```
User (browser, any device)
  │  upload audio file
  ▼
Engram (Next.js on Railway)
  ├─ store bytes ──────────────▶ Cloudflare R2 (presigned PUT/GET)
  ├─ transcribe: presigned GET URL ──▶ ElevenLabs Scribe v2 ──▶ diarized segments
  ├─ enhance: transcript text ──▶ Vercel AI SDK (generateObject) ──▶ summary/actions/keypoints
  └─ persist everything ───────▶ Postgres (Drizzle)
  ▼
Detail page: transcript + summary + HTML5 <audio> player (audio served via presigned R2 GET)
```

The pipeline runs as **route handlers** in Phase 0 (synchronous enough for sample files via Scribe's single-call batch API). A persistent background worker is a Phase 1 concern (long syncs); Phase 0 does not need it.

## Components (each does one thing)

1. **Storage layer** (`src/lib/storage/`)
   - Interface: `put(key, bytes, contentType) → key`, `presignedGetUrl(key, ttl) → url`, `delete(key)`.
   - One R2/S3 adapter (AWS SDK v3 `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` pointed at the R2 endpoint).
   - Shape leaves room for a future local-volume adapter without touching callers.

2. **Transcription adapter** (`src/lib/transcription/`)
   - Port `elevenlabs-provider.ts` as-is: single Scribe call, word→speaker-segment grouping.
   - Phase 0 passes Scribe a **presigned R2 GET URL** (`cloud_storage_url`) — no bytes flow back through Engram.
   - Returns `{ text, language, segments: {start,end,text,speaker}[] }`.

3. **LLM enhancement** (`src/lib/ai/`)
   - Vercel AI SDK. `generateObject` with a Zod schema → `{ title, summary, actionItems[], keyPoints[] }`.
   - Provider/model read from config (default OpenAI `gpt-5.4-mini-2026-03-17`), swappable.
   - Prompt instructs Dutch-language output, speaker-aware action-item attribution (segments carry speaker labels).

4. **Pipeline orchestration** (route handlers)
   - `POST /api/recordings` — accept upload, store to R2, create `recordings` row (status `uploaded`).
   - `POST /api/recordings/[id]/transcribe` — presign GET, call Scribe, write `transcriptions`, advance status.
   - `POST /api/recordings/[id]/enhance` — read transcript, call LLM, write `ai_enhancements`, advance status.
   - (Phase 0 can chain transcribe→enhance automatically after upload; status field tracks progress.)

5. **UI** (minimal, shadcn)
   - Recordings **list** (title/date/status).
   - **Upload** form.
   - **Detail** page: HTML5 `<audio>` (presigned R2 GET src) + speaker-labeled transcript + summary/action-items/key-points. No waveform, no click-to-seek, no search/export (deferred).

6. **Auth** (last task)
   - Better Auth single-user, email/password, verification off, no reset email; optional passkey plugin.
   - Wrap app routes; expose login page. No mail provider.

## Data model (Drizzle, Phase 0 subset)

- `recordings` — id, title, source (`upload` for now), storage_key, content_type, duration, status (`uploaded`→`transcribing`→`transcribed`→`enhancing`→`done`/`error`), created_at. (`plaud_file_id` column included but nullable, for Phase 1.)
- `transcriptions` — id, recording_id, full_text, language, segments (jsonb: `{start,end,text,speaker}[]`), created_at.
- `ai_enhancements` — id, recording_id, kind (default `summary`), title, summary, action_items (jsonb), key_points (jsonb), model, created_at. (Multiple rows per recording allowed — Phase 2 multi-view ready.)
- `api_credentials` — encrypted provider keys (AES-256-GCM). Phase 0: ElevenLabs + OpenAI keys may live in env vars; table exists for Phase 1 Plaud tokens. **Encryption util built in Phase 0.**
- `storage_config` — R2 bucket/endpoint/creds reference (creds via env; row records active backend + bucket).
- `user_settings` — language default, active LLM model/provider.
- `sync_state` — last cursor / last-synced timestamp. Created in Phase 0 (empty), used in Phase 1.
- Better Auth tables — created by Better Auth's own migration when auth is added.

## Error handling

- Each pipeline stage is idempotent and sets `recordings.status`; failures write `status='error'` + an error message column, surfaced in the UI. A failed stage can be retried via its route.
- Scribe / LLM / R2 calls wrap network errors with context (which stage, which recording id).
- Uploads validated for content-type and a sane size ceiling before hitting R2.

## Testing

- **Storage adapter:** integration test against R2 (put → presign → fetch round-trip).
- **Transcription adapter:** unit test `wordsToSegments` (speaker grouping, spacing, audio-event drop) with fixture word arrays; one live smoke test against the sample Dutch clip.
- **LLM enhancement:** schema-validation test (mock model returns a fixture object matching the Zod schema); one live smoke test for Dutch summary quality.
- **Pipeline:** end-to-end manual run with the sample file is the Phase 0 acceptance test — transcript reads correctly, speakers separated, summary is good Dutch.

## Out of scope (later phases)

- Plaud MCP OAuth + sync worker (Phase 1).
- Waveform player, click-to-seek, full-text search, exports, notifications (Phase 1+).
- Multi-view summaries, templates, mind maps, Ask-Engram RAG, iOS client (Phase 2).
- Background worker service (Phase 1 — only needed for long syncs).

## Phase 0 task order (also drives `PROGRESS.md`)

1. Scaffold Next.js 16 + TS + pnpm; shadcn init.
2. Drizzle + Postgres; schema above; first migration.
3. AES-256-GCM secret-encryption util.
4. R2 storage interface + adapter; round-trip test.
5. Scribe transcription adapter; unit test + live smoke.
6. Vercel AI SDK enhancement layer + Zod schema; test + live smoke.
7. Pipeline route handlers (upload / transcribe / enhance) with status tracking.
8. Minimal UI (list / upload / detail + audio player).
9. **Better Auth** (single-user, no email) — last.
10. Deploy to Railway (app + Postgres); verify login + pipeline from phone.
