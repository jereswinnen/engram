# Engram — Design: Scheduled (Automated) Plaud Sync

**Date:** 2026-06-23
**Status:** Approved design, pre-implementation
**Scope:** Automate the existing manual Plaud sync so new recordings are picked up — and the AI layer (transcription + enhancement) runs — on a schedule, without clicking "Sync now".

## Goal

Run `syncPlaud()` automatically every hour via a Railway cron service hitting the existing `/api/sync` endpoint, with a concurrency guard so a scheduled run can't overlap a manual one (or a slow previous run) and double-import/double-pay.

## Background (already in place — no change)

- `POST /api/sync` is **already cron-ready**: `isAuthorized` accepts `Authorization: Bearer ${CRON_SECRET}` *or* a logged-in session.
- `syncPlaud()` already lists Plaud files, imports new ones, and runs `runTranscription` → `runEnhancement` per recording; it writes its outcome to `syncState.lastResult` (shown in Settings).
- Plaud OAuth tokens live encrypted in the DB (`apiCredentials`), so any trigger (cron service hitting the endpoint) can drive a sync.

## Locked decisions

| Area | Decision |
|---|---|
| Trigger | A **Railway cron service** (same repo, schedule `0 * * * *` = hourly) running a script that calls `POST /api/sync` with the `CRON_SECRET` bearer. |
| Trigger script | `scripts/sync-cron.mjs` — plain Node ESM using built-in `fetch` (**no tsx/curl/deps**, so a pruned prod install can't break it). |
| Auth | Existing `CRON_SECRET` bearer. Set the secret on the web service (to validate) and the cron service (to send). No route changes. |
| Concurrency | A self-healing lock: `syncState.runningSince` timestamp. `syncPlaud` skips if it's set and recent (TTL 30 min); sets it at start; clears it in `finally`. |
| Observability | None new — `syncState.lastResult` (Settings) + the Railway cron service's run logs. A skipped run does **not** overwrite `lastResult`. |

## Components

1. **DB:** add `runningSince` (timestamp, nullable) to `syncState`. One additive migration.
2. **`lib/plaud/sync.ts`** — wrap `syncPlaud()` in the concurrency guard:
   - After loading the sync row: if `runningSince` is set and `< 30 min` old → return early with a `note` ("skipped — a sync is already running") and **do not** write `lastResult`.
   - Else set `runningSince = now`, run the existing body (incl. the not-connected / connect-failed / list-failed early returns), and clear `runningSince` in a `finally` (so it self-heals on any exit path; the 30-min TTL covers a hard crash).
   - `SyncResult` gains an optional `note?: string` (used only for the skip case).
3. **`scripts/sync-cron.mjs`** — reads `APP_URL` + `CRON_SECRET` from env; `POST ${APP_URL}/api/sync` with the bearer header; logs the JSON result; `process.exit(1)` on a network error, a non-OK HTTP status, or a result carrying `error` (so Railway flags failed runs); exit 0 otherwise (incl. a skipped run).
4. **`package.json`** — `"sync:cron": "node scripts/sync-cron.mjs"` (convenience; the cron service's start command).
5. **`DEPLOY.md`** — exact Railway cron-service setup steps (below).

## Railway cron service setup (documented in DEPLOY.md — user performs once)

1. Generate a strong random `CRON_SECRET`; set it as an env var on the **web** service.
2. In the same Railway project, **add a new service from the same GitHub repo** (it shares the repo/image).
3. On that new service: set a **Cron Schedule** of `0 * * * *`, and a **Start Command** of `node scripts/sync-cron.mjs`.
4. Set env vars on the cron service: `CRON_SECRET` (same value as the web service) and `APP_URL` = the web app's URL (the public `https://…` URL is simplest; the internal `http://<web-service>.railway.internal:<port>` avoids public egress if preferred).
5. Railway runs the service on the schedule; the script POSTs to `/api/sync`, then exits. Run history + logs appear on that service.

## Error handling

- Endpoint unreachable / non-200 / result has `error` (e.g. "reconnect needed — Plaud authorization expired") → script exits non-zero → Railway marks the run failed; the reason is visible in the cron logs and in Settings (`lastResult.error`).
- Overlap: a second run while one is active → skipped (no double-import). A crashed run that left `runningSince` set → the 30-min TTL lets the next run proceed.
- `syncPlaud`'s existing per-item resilience (failures/deferred audio, checkpoint-not-advanced-past-blockers) is unchanged and still applies.

## Testing

- **`lib/plaud/sync.test.ts`** (existing mocked harness): `runningSince` recent → returns the skip `note`, performs no processing, and does **not** write `lastResult`; `runningSince` stale (> TTL) → proceeds normally; `runningSince` is cleared in `finally` even on an early return (e.g. not connected). The existing sync tests (ingest, skip, checkpoint, deferred, failure) still pass with the guard wrapping the body.
- **`scripts/sync-cron.mjs`** — thin (fetch + exit code); verified manually (a local run against the app with the bearer, and on the first real Railway cron run).
- `pnpm exec tsc --noEmit` clean; full suite green.

## Out of scope (later)

- Per-recording push notifications on new sync; configurable schedule in the UI; backfill of historical recordings; retry/alerting beyond Railway's run status.

## Task order (drives the plan + PROGRESS)

1. `syncState.runningSince` migration + the concurrency guard in `syncPlaud` (+ `SyncResult.note`) + tests.
2. `scripts/sync-cron.mjs` + the `sync:cron` package script.
3. `DEPLOY.md` Railway cron-service setup steps + PROGRESS.
