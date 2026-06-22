> ⚠️ SUPERSEDED — the reverse-engineered approach was abandoned (the Plaud MCP is free). See the official-MCP spec/plan dated 2026-06-22. Kept for history only.

# Engram — Phase 1 Design: Plaud Sync (reverse-engineered)

**Date:** 2026-06-22
**Status:** Approved design, pre-implementation
**Supersedes:** the original Phase 1 "official Plaud MCP" plan in `docs/engram-context.md`. The official MCP (`mcp.plaud.ai`) is gated behind Plaud's paid **Unlimited** plan, which the user declines (paying Plaud's premium tier to extract data defeats Engram's purpose). This phase uses Plaud's private API instead.

## Goal

Automatically pull recordings from a **normal (non-Unlimited) Plaud account** into Engram — no device dependency, laptop-independent — and run them through the existing Phase 0 pipeline (Scribe → LLM enhancement). Capture becomes automatic instead of manual upload.

## Approach & rationale

Plaud has no public API on a normal plan. The web app (`web.plaud.ai`) and mobile app talk to a **private API at `api.plaud.ai`** using a bearer **session token** (`tokenstr`, a long-lived ~10-month JWT). Several open-source projects sync this way (Riffado, plaud-sync-for-obsidian, plaud-mirror). Engram does the same — but **clean-room**: we derive the API surface by observing `web.plaud.ai`'s own network calls with the user's token, and write our own client. We do **not** copy Riffado's AGPL code; Engram stays a non-AGPL, owned codebase.

### Accepted tradeoffs (explicitly chosen by the user)
1. **Private, undocumented API** — can break without notice if Plaud changes their backend. This is code we maintain reactively.
2. **Likely crosses Plaud's ToS.** It is the user's own data and a common interop practice, but it is not a blessed path. This reverses the project's original "official/durable, not reverse-engineered" principle — a deliberate decision after the MCP turned out to be paywalled.
3. **Clean-room / AGPL** — no Riffado code is copied; we implement from the observed API only.

## Locked decisions

| Area | Decision |
|---|---|
| Auth | **Paste-token MVP.** User grabs `localStorage.getItem("tokenstr")` from `web.plaud.ai` once, pastes into Settings; stored AES-encrypted in `api_credentials` (`provider='plaud'`). Re-paste on expiry (~10mo). Automated email/OTP login is deferred. |
| API base | `https://api.plaud.ai` (region-dependent; configurable). |
| Sync trigger | **Manual "Sync now" button** (Settings, session-gated) **+ Railway-cron** POST to `/api/sync` (secret-gated) every N minutes. |
| Incremental strategy | Checkpoint on max ingested `start_time` in `sync_state`; dedup on `recordings.plaud_file_id`; skip trashed. Checkpoint advances only after a batch completes. |
| Transcription | **Re-transcribe with Scribe** (existing pipeline). Ignore Plaud's own `note_list`/`source_list` (YAGNI). |
| Downstream | Reuse Phase 0 `getStorage()` (R2) + `runTranscription` + `runEnhancement` unchanged. |
| Build mode | User has a Plaud account but **no recordings yet** → verify token + list endpoint live; download/transcribe + exact field mapping are deferred smokes until a test recording exists. |

## Architecture / data flow

```
Settings UI ──(paste session token)──▶ api_credentials (AES-encrypted, provider='plaud')
                                              │
   "Sync now" (session) ─┐                    ▼
   Railway cron (secret) ┴─▶ POST /api/sync ─▶ Plaud client (api.plaud.ai)
       listRecordings() → filter trashed → keep start_time > sync_state checkpoint
       → for each new (not already in recordings by plaud_file_id):
            getRecordingDetail(id) → download audio (signed URL) → R2 (getStorage().put)
            → insert recordings row (source='plaud', plaud_file_id, storageKey)
            → runTranscription(id) → runEnhancement(id)   [existing pipeline]
       → write sync_state.lastResult; advance checkpoint only after batch completes
```

## Components (isolated, testable)

1. **`lib/plaud/types.ts`** — typed shapes for a Plaud recording summary + detail (id, name, created_at, start_at, duration[ms], serial_number, presigned/signed audio URL, trashed flag). One place to adjust when field names are finalized.

2. **`lib/plaud/client.ts`** — thin `api.plaud.ai` HTTP client. Functions: `validateToken(token)` (→ current user / ok), `listRecordings(token, { since? })`, `getRecordingDetail(token, id)`, `downloadAudio(signedUrl)`. Bearer token injected per call. Pure HTTP + a single mapping layer from raw JSON → `lib/plaud/types`. No DB/storage knowledge.

3. **`lib/plaud/sync.ts`** — orchestration. `syncPlaud(deps)`:
   - read token (decrypt) + checkpoint (`sync_state`);
   - `listRecordings`, filter trashed, filter `start_time > checkpoint`, filter out `plaud_file_id` already in `recordings`;
   - for each: detail → download → `storeAudio` → insert recording → `runTranscription` → `runEnhancement`;
   - isolate per-item errors (continue batch; failed recording carries `status='error'`);
   - write `sync_state.lastResult` (counts + error + ranAt); advance checkpoint to max processed `start_time` only after the batch completes.
   Depends on injected deps (`getStorage`, pipeline fns, db accessors) so it's unit-testable with mocks.

4. **`app/api/sync/route.ts`** — `POST`. Authorizes via **either** a valid session (manual button) **or** a `CRON_SECRET` bearer header (cron); else 401. Calls `syncPlaud`. Returns the sync summary.

5. **Settings page** — `app/settings/page.tsx` (`requireSession`-guarded) + small client pieces:
   - paste + save token (POST to a settings/credentials route that AES-encrypts and stores it);
   - connection status (calls `validateToken`); shows connected / not connected (never echoes the full token — at most last 4 chars);
   - **"Sync now"** button → POST `/api/sync`;
   - last-sync result (from `sync_state.lastResult`): counts (new/skipped/failed), ran-at, any error / "reconnect needed".
   - A nav link to Settings from the app header.

6. **Cron wiring** — `railway.json` (or Railway dashboard cron) → scheduled `POST /api/sync` with `Authorization: Bearer ${CRON_SECRET}` every N minutes.

## Data model changes (minimal)

- `recordings` — **no change**. Synced rows set `source='plaud'` and `plaud_file_id` (already `unique`, the dedup key).
- `sync_state` — repurpose `lastSyncedAt` as the `start_time` checkpoint; **add `lastResult` (jsonb)** = `{ ranAt, newCount, skippedCount, failedCount, error? }`. One small migration.
- `api_credentials` — **no change**. One row `provider='plaud'`, `ciphertext` = encrypted token.

## Security

- Token AES-encrypted at rest (existing util); never logged; never returned to the client after save (status only, optional last-4).
- `/api/sync`: session **or** `CRON_SECRET` bearer; otherwise 401. New env var `CRON_SECRET` (generate `openssl rand -hex 32`), added to `.env.example`, `DEPLOY.md`, Railway, and the cron job header.
- Settings + credential-save routes `requireSession`-guarded (same pattern as Phase 0 data routes).
- The session token grants full Plaud account access — treat it as a high-value secret in handling and UI.

## Error handling

- Per-recording isolation: one failed download/transcription doesn't abort the batch; that recording is `status='error'` with a message (existing pipeline behavior).
- Plaud `401`/expired token: stop, set `sync_state.lastResult.error='reconnect needed'`, surface in Settings, do **not** advance checkpoint.
- Network/5xx: retry with backoff inside the client for transient failures; permanent failures surface immediately.
- Checkpoint advances only after a batch completes → a crash mid-run safely re-processes uningested items next run (dedup prevents duplicates).

## Testing

- **`lib/plaud/client.ts`** — unit-test the raw-JSON → typed mapping with fixtures; test bearer header injection and error→throw mapping (mocked `fetch`).
- **`lib/plaud/sync.ts`** — unit-test checkpoint filtering, `plaud_file_id` dedup, trashed filter, per-item error isolation, and "checkpoint advances only after batch" — all with mocked client + mocked storage/pipeline/db (mirrors the Phase 0 `pipeline.test.ts` style).
- **`/api/sync`** — auth gate (session vs `CRON_SECRET` vs 401) must typecheck; thin wrapper otherwise.
- **Live smokes (deferred, explicitly marked):** (a) token validate + `listRecordings` against the real account [doable now]; (b) full detail → download → transcribe once a test recording exists, which also finalizes the field mapping in `lib/plaud/types`.

## Out of scope (later)

- Automated email/OTP login (paste-token covers auth).
- Importing Plaud's own transcripts/summaries.
- Hardware device onboarding (works identically once recordings reach the Plaud cloud).
- The Phase 1+ UX features (waveform, search, export, notifications) and all of Phase 2.

## Task order (will drive the plan + PROGRESS)

1. `sync_state.lastResult` migration.
2. `lib/plaud/types.ts` + `lib/plaud/client.ts` (+ mapping unit tests).
3. `lib/plaud/sync.ts` orchestration (+ checkpoint/dedup/error unit tests).
4. `/api/sync` route (session-or-`CRON_SECRET` gate) + credential-save route.
5. Settings page (paste token, status, Sync now, last result) + header nav link.
6. `CRON_SECRET` env wiring + Railway cron config + `.env.example`/`DEPLOY.md` updates.
7. Live verify: token + list now; download/transcribe + field-mapping finalize on first real recording (deferred).
