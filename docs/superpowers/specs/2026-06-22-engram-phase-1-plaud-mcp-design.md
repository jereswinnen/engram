# Engram — Phase 1 (redo) Design: Official Plaud MCP Sync

**Date:** 2026-06-22
**Status:** Approved design, pre-implementation
**Supersedes:** `docs/superpowers/specs/2026-06-21-engram-phase-1-plaud-sync-design.md` (reverse-engineered `api.plaud.ai`). That route was built and merged when we believed the MCP required Plaud Unlimited; the MCP is in fact **free** on a normal account, so we revert to the official, documented, durable MCP path — the original intent.

## Goal

Automatically pull recordings from a normal Plaud account into Engram via the **official Plaud MCP** (`mcp.plaud.ai`), with no device dependency, and run them through the existing Phase 0 pipeline (Scribe → LLM enhancement).

## Strategy: swap two layers, keep the rest

The reverse-engineered Phase 1 is on `main`. Only the **auth** and **client** layers were actually reverse-engineered; the orchestration, route, Settings shell, and DB migration are approach-agnostic. We therefore **remove the reverse-engineered layer and rebuild it on the MCP**, keeping the reviewed scaffolding (and its hard-won durability fixes).

### Remove
- `lib/plaud/client.ts` (REST `api.plaud.ai`) + `lib/plaud/client.test.ts`
- `lib/plaud/credentials.ts` (pasted-token store) — replaced by `lib/plaud/mcp/auth-store.ts`
- `app/api/plaud/token/route.ts` (paste-token save/status)
- `config.plaudApiBase` + its test
- the paste-token widget in the Settings page

### Keep / reuse (unchanged or lightly adapted)
- `lib/plaud/sync.ts` — orchestrator: `plaud_file_id` dedup, `start_time` checkpoint, **checkpoint-never-past-failure**, **orphan-row cleanup on post-insert failure**, per-item error isolation, R2 + `runTranscription`/`runEnhancement` reuse. Now calls the MCP client.
- `app/api/sync/route.ts` — session-OR-`CRON_SECRET` gate (unchanged).
- Settings page shell + "Sync now" + last-result display.
- `sync_state` + `lastResult` column (already migrated — **no new migration**), `recordings.source='plaud'`/`plaud_file_id`, `api_credentials`, the AES util, `requireSession`, the Railway cron docs.

## Locked decisions

| Area | Decision |
|---|---|
| Transport | Official MCP, `https://mcp.plaud.ai/mcp`, **streamable HTTP** via `@modelcontextprotocol/sdk`. |
| Auth | **Interactive OAuth 2.x PKCE**: Settings "Connect Plaud" → redirect to Plaud authorize URL → `/api/plaud/callback` exchanges code → tokens stored AES-encrypted. Subsequent syncs reconnect headlessly with stored tokens (SDK auto-refresh). |
| Token storage | A single AES-encrypted JSON blob in `api_credentials` (`provider='plaud'`) holding `{ tokens, clientInformation, codeVerifier }`. No schema change. |
| Dynamic client registration | Attempt DCR (SDK default); if Plaud doesn't support it, seed a manually-registered client into the store. Verified at the live Connect step. |
| Incremental | `list_files` with `date_from` = `sync_state` checkpoint, paging via `page`/`page_size`; dedup on `plaud_file_id`; advance checkpoint to max `start_at` after the batch. |
| Transcription | Re-transcribe with Scribe (existing pipeline); ignore Plaud's `note_list`/`source_list` (YAGNI). |
| Build mode | **Verified.** User is connected with a recording → authorize for real and confirm `list_files`→`get_file`→download→transcribe live during the build (no deferred field-guessing). |
| Redirect URI | `<app-origin>/api/plaud/callback`, derived from an env var (Railway domain in prod, `localhost:3000` in dev); must be registered with the OAuth client. |

## Architecture / data flow

```
Settings (logged in) ── "Connect Plaud" ──▶ GET /api/plaud/connect
   authProvider builds PKCE authorize URL ──▶ redirect browser to Plaud ── user Authorizes ──▶
GET /api/plaud/callback?code=… ── finishAuth(code) → tokens ──▶ auth-store (AES-encrypted JSON in api_credentials)

   "Sync now" (session)  ─┐
   Railway cron (secret) ─┴─▶ POST /api/sync ─▶ connect MCP (stored tokens, auto-refresh)
        list_files(date_from=checkpoint, page,page_size) → filter new (dedup plaud_file_id)
        → for each: get_file → download presigned_url → R2 → recordings(source='plaud', plaud_file_id)
          → runTranscription → (if status==='transcribed') runEnhancement
        → write sync_state.lastResult; advance checkpoint after the batch (never past a failure)
   On auth/refresh failure: lastResult.error='reconnect needed', checkpoint NOT advanced.
```

## Components (clean, modular — one responsibility each)

`lib/plaud/mcp/`:
1. **`types.ts`** — `PlaudFile { id; name?; startAt?; startAtMs?; durationMs?; trashed? }`, `PlaudFileDetail extends PlaudFile { presignedUrl: string }`, and a `parseToolJson<T>(result)` helper (MCP tool results are `{ content: [{type:'text', text}] }`). Field mapping tolerant but verified live.
2. **`auth-store.ts`** — `PlaudAuthStore` backed by `api_credentials`. Loads/decrypts the JSON blob and exposes `getTokens/saveTokens`, `getClientInfo/saveClientInfo`, `getCodeVerifier/saveCodeVerifier`, `clear()`. One responsibility: persist OAuth state (AES-encrypted). No MCP knowledge.
3. **`oauth-provider.ts`** — `PlaudOAuthProvider implements OAuthClientProvider`, wired to `auth-store`; `clientMetadata` (redirect URI, scopes, PKCE), `redirectToAuthorization` (returns/stores the URL for the route to redirect to). Mirrors `docs/plaud-mcp-sync.ts`.
4. **`client.ts`** — `connect()` (Client + StreamableHTTPClientTransport + provider), `finishAuth(code)`, `listFiles(args)`, `getFile(id)`, `downloadAudio(url)`. Pure MCP-SDK wrapper + `parseToolJson`. No DB/storage knowledge.

Reused/adapted: `lib/plaud/sync.ts`, `app/api/sync/route.ts`, Settings page.

New routes (all `requireSession`/session-guarded):
- `app/api/plaud/connect/route.ts` — initiates OAuth, redirects the browser to Plaud's authorize URL.
- `app/api/plaud/callback/route.ts` — receives `?code=`, calls `finishAuth`, redirects back to Settings (error → Settings with an error flag).
- `app/api/plaud/disconnect/route.ts` — `auth-store.clear()`.

Settings page: connection status (connected/not), **Connect** / **Disconnect** buttons, "Sync now" (disabled when not connected), last-sync result.

## Data model

No new migration. `api_credentials` row `provider='plaud'`, `ciphertext` = AES-encrypted JSON `{ tokens, clientInformation, codeVerifier }`. `sync_state` (+`lastResult`) and `recordings` unchanged.

## Security

- All OAuth artifacts AES-encrypted at rest; never logged; never returned to the client (Settings shows only connected/not-connected).
- `/api/plaud/connect|callback|disconnect` session-guarded; `/api/sync` session-OR-`CRON_SECRET` (unchanged). PKCE + the SDK's state handling protect the OAuth handshake against CSRF — verified at the live step.
- Redirect URI fixed to `<app-origin>/api/plaud/callback`; only the registered URI is accepted by Plaud.
- The OAuth tokens grant full Plaud account access — treated as high-value secrets throughout.

## Error handling

- Callback without `code`, or token exchange failure → no partial state saved; Settings shows an error.
- Expired/revoked tokens (refresh fails) → sync writes `lastResult.error='reconnect needed'`, does NOT advance the checkpoint, Settings prompts reconnect.
- Per-item failures isolated; orphan row deleted on post-insert failure; checkpoint never advances past the earliest failed item (carried over from the reverse-engineered build's durability fixes).

## Testing

- **`auth-store`** — save→load round-trip of `{tokens, clientInformation, codeVerifier}` through encryption; `clear()` removes state (mocked db + real AES util).
- **`client`** — `parseToolJson` (text-block concatenation + JSON.parse); `listFiles`/`getFile` map tool results to `PlaudFile`/`PlaudFileDetail` with fixtures (mocked `Client.callTool`).
- **`sync`** — reuse/adapt the existing dedup/checkpoint/durability/error-isolation tests against a mocked MCP client.
- **Routes** — auth gates typecheck; `callback` calls `finishAuth` with the code.
- **Live (verified, during build):** real Connect (OAuth handshake, incl. confirming DCR vs manual client), `list_files`, `get_file`, download, transcribe end-to-end against the user's recording.

## Out of scope (later)

- Importing Plaud's own transcripts/summaries; the Phase 1+ UX features (waveform, search, export, notifications); all of Phase 2. Hardware device onboarding works identically once recordings reach the Plaud cloud.

## Task order (drives the plan + PROGRESS)

1. Remove the reverse-engineered layer (REST client, pasted-token store, token route, `plaudApiBase`, paste-token UI) — leave the reusable scaffolding intact + suite green.
2. Add `@modelcontextprotocol/sdk`; `lib/plaud/mcp/types.ts` + `parseToolJson` (+ tests).
3. `lib/plaud/mcp/auth-store.ts` (+ encrypt/decrypt round-trip tests).
4. `lib/plaud/mcp/oauth-provider.ts` + `lib/plaud/mcp/client.ts` (+ tool-mapping tests).
5. Adapt `lib/plaud/sync.ts` to the MCP client (+ adapted durability tests).
6. Routes: `connect`, `callback`, `disconnect`; rewire Settings to Connect/Disconnect/status.
7. Env/docs: redirect-URI env var, update `.env.example`/`DEPLOY.md`/`PROGRESS.md` (MCP OAuth setup; cron unchanged).
8. Live verify (build-time): OAuth handshake + full sync against the real recording.
