# Engram — Project Context

> Drop this in the repo root (rename to `CLAUDE.md` or `CONTEXT.md` if you want Claude Code to auto-load it).
> **Engram** is a self-hosted, from-scratch Next.js app that pulls my Plaud recordings out of Plaud's cloud via the **official Plaud MCP**, transcribes them with **ElevenLabs Scribe v2**, summarizes them with my own LLM, and stores everything on infrastructure I control. No Riffado, no AGPL — fully my own codebase.

## Why / shape of the project

Replace Plaud's AI subscription with my own model keys, keep a durable copy of audio + transcripts, and own the whole pipeline. Personal tool (single user), but I want to own the sync layer rather than fork someone else's. Most meetings are **Dutch with occasional English jargon** (Belgian tech context), multi-speaker, so diarization matters. Based in Belgium → EU data residency is a preference (see tradeoff note).

Deployed to **Railway** (always-on container + managed Postgres), so it's reachable from any device behind a login, and background sync runs whether or not my laptop is open.

## Architecture / data flow

```
Plaud Note Pro ──(Bluetooth or Wi-Fi charging-sync)──▶ Plaud Cloud
Plaud Desktop (Google Meet/Zoom/Teams) ─────────────▶ Plaud Cloud
                                                          │
                              Engram MCP client (scheduled worker on Railway)
                                       list_files → get_file → download
                                                          ▼
                                                        Engram
                          ┌───────────────┬─────────────┴──────────────┐
                          ▼               ▼                            ▼
                   own storage      ElevenLabs Scribe v2         own LLM (summaries,
                 (Railway vol/R2)  transcribe + diarize          action items, Ask-Engram)
                          │
                          ▼
                 Web UI (any device) + future native iOS client (same REST API)
```

Engram syncs whatever is in the **Plaud cloud account**, regardless of capture source (hardware device or Plaud Desktop). Everything downstream of "audio in the cloud" is automatic and laptop-independent.

## Stack

- **Framework**: Next.js 16 (App Router), TypeScript.
- **DB / ORM**: PostgreSQL + Drizzle (Railway managed Postgres). `pgvector` later for RAG.
- **Auth**: Better Auth (single user, but behind login since it's public-facing).
- **Sync**: official **Plaud MCP** consumed via the MCP TypeScript SDK (`@modelcontextprotocol/sdk`) in a scheduled worker.
- **Transcription**: ElevenLabs **Scribe v2** (batch). Companion adapter: `elevenlabs-provider.ts`.
- **LLM**: Claude Sonnet 4.6 (best Dutch) or Gemini 3 Flash (cheaper). Swappable — OpenAI-compatible baseURL + key.
- **Storage**: Railway volume (`/app/audio`) or S3-compatible (R2/S3/MinIO/B2).
- **Deploy**: Railway — app service + Postgres + (optional) a separate worker service for the sync cron. Persistent container → no serverless timeouts on sync or long transcriptions.
- **My defaults**: Next.js/TS/Drizzle/Postgres, Railway for persistent/cron workloads, M-series Mac for local dev.

## Sync layer — the Plaud MCP route (the new core)

Consume Plaud's **official** MCP server (`mcp.plaud.ai`) — documented and durable, not reverse-engineered.

- **Auth**: OAuth 2.x (PKCE). Single-user → authorize once, persist tokens + refresh. Verify the exact flow against Plaud's MCP docs (auth is where this gets finicky).
- **Tools**: `list_files` (filter new since last cursor, paginated), `get_file` (metadata + presigned audio URL + transcript segments), `get_transcript` (Plaud's own transcript — optional, since we run Scribe).
- **Loop** (scheduled worker on Railway):
  1. `list_files` → new recordings since `sync_state.last_cursor`.
  2. For each: `get_file` → download the presigned audio → write to storage.
  3. Hand audio to the Scribe adapter → store transcript/segments.
  4. Run the LLM layer → store summary/action items/key points.
  5. Notify (browser/email) → advance the cursor.
- **Verify in practice**: that the presigned URL downloads programmatically; pagination + any rate limits; that the worker runs as a persistent Railway service (not a Vercel function).

Upstream dependency: **Plaud Cloud Sync must be ON** for anything to reach the cloud for Engram to fetch. (Wi-Fi "sync to cloud while charging" makes the device→cloud hop hands-free.)

## Transcription — ElevenLabs Scribe v2

- **$0.22/hr** (PAYG). Diarization **included**. Optional add-ons: entity detection +$0.07/hr, keyterm prompting +$0.05/hr (skip unless needed).
- Use the **batch** model (`scribe_v2`) — Scribe v2 Realtime has no diarization.
- Language: leave `language_code` unset (auto-detect) so embedded English is absorbed natively, or force `"nld"` for pure Dutch. No explicit code-switching config — the multilingual model handles mixed NL/EN.
- Single synchronous call returns word-level results with `speaker_id`; the adapter groups words into `{ start, end, text, speaker }` segments. Pass audio as a Blob (local storage) or `cloud_storage_url` (R2/S3 presigned). For files near the 10h limit, use the async + webhook variant.

## EU data-residency tradeoff (note, not a blocker)

ElevenLabs is US-based. EU Data Residency + Zero Retention modes exist but may be tier-gated — verify on my plan and enable. (Gladia is the EU-native fallback if residency becomes a hard requirement: ~$0.61/hr, diarization included, EU by default.)

## Features (Engram's own — the good parts of Riffado, reimplemented)

These are the capabilities to build toward, lifted from what Riffado does well and re-done as my own code:

- **Audio player with waveform** (Wavesurfer.js) and **transcript side-by-side**, click-to-seek.
- **Speaker-labeled transcripts** (from Scribe diarization) with timestamps.
- **Full-text search** across every recording's transcript.
- **AI enhancements**: auto-generated titles, summaries, action items, key points.
- **Storage choice**: local volume or any S3-compatible bucket — I own the audio.
- **Export**: JSON, TXT, SRT/VTT subtitles, and one-click full backup.
- **Notifications**: browser + email (SMTP) when a new recording is processed.
- **Encrypted secrets**: API keys + Plaud tokens encrypted at rest (AES-256-GCM).
- **Own REST API**: so I can later wrap a native iOS client or PWA around the same backend.
- **Durable copy**: recordings persist in my storage even if I disconnect Plaud later.

## Data model (Engram schema)

- `recordings` — metadata + storage path + plaud_file_id + capture source.
- `transcriptions` — full text + segments (`start`, `end`, `text`, `speaker`).
- `ai_enhancements` — summaries / action items / key points (allow multiple "views" per recording for Phase 2).
- `api_credentials` — encrypted provider keys + Plaud OAuth tokens.
- `storage_config` — local vs S3/R2 settings.
- `user_settings` — preferences, language defaults.
- `sync_state` — last MCP cursor / last-synced timestamp for dedup.
- (Phase 2) `embeddings` via `pgvector` for RAG.

## Build sequence

**Phase 0 — today (no device needed, use a Dutch sample audio file):**
1. ElevenLabs account + API key. Validate Scribe quality on a real Dutch multi-speaker clip via the web app. Enable PAYG; verify/enable EU residency if available.
2. `create-next-app` → scaffold Engram. Set up Drizzle + Postgres schema above. Better Auth.
3. Build the **Scribe adapter** + a `/api/recordings/[id]/transcribe` route; test on the sample file.
4. Storage config: Railway volume vs R2. If R2, bucket + creds + presigned-URL handoff.
5. LLM key (Claude/Gemini) + a summary route; confirm a summary off the test transcript.
6. Deploy the skeleton to Railway (app + Postgres) so the URL + login work from my phone.

**Phase 1 — Plaud MCP + device:**
7. OAuth-authorize the Plaud MCP; store tokens. Build the **MCP sync client** (list_files → get_file → download → store) as a scheduled Railway worker.
8. After device arrives: create Plaud account, enable **Private Cloud Sync** (+ Wi-Fi charging-sync toggle — verify on Note Pro).
9. First real end-to-end sync → transcribe → summarize.
10. Verify **Plaud Desktop → Plaud cloud → MCP → Engram** with one Google Meet recording.

**Phase 2 — closer to Plaud Intelligence / nice-to-haves:**
- Multidimensional / role-specific summaries (multiple prompt passes; multiple `ai_enhancements` rows).
- Template library (`templates` table = name + prompt + optional output schema).
- Mind maps (prompt → hierarchical JSON → render with markmap/react-flow).
- **Ask-Engram** RAG: chunk transcripts → embed → `pgvector` → retrieve → answer with citations back to word timestamps.
- Glossary/jargon: Scribe keyterm prompting (+$0.05/hr) or an LLM post-edit pass.
- Native **iOS client** (SwiftUI/SwiftData) against Engram's REST API.

## Cost model

- Transcription (Scribe): **$0.22/hr** (diarization included). 10h/mo → ~$2.20 · 30h → ~$6.60 · 50h → ~$11.
- LLM summaries: pennies/hr (~$0.02–0.20).
- Hosting: Railway app + Postgres (~$5–20/mo depending on usage) + storage.
- vs Plaud Pro ~$18/mo flat. At my volume, all-in is comparable or cheaper, and I own everything.

## Gotchas / to verify

- **Plaud Cloud Sync must be ON** — Engram can only fetch what reaches Plaud's cloud.
- **MCP OAuth flow** — verify the exact handshake against Plaud's MCP docs; confirm my account can authorize it and check for scope/rate limits.
- **Presigned URL** from `get_file` must download programmatically.
- **Persistent worker on Railway** for sync + long transcriptions (not a Vercel serverless function).
- **Wi-Fi charging-sync toggle** on the Note Pro — verify it exists (support doc is NotePin-specific) for fully hands-free device→cloud.
- **Plaud Desktop recordings** appear via the MCP — verify with the first online meeting.
- **Scribe batch** (`scribe_v2`) for diarization; Realtime has none.
- **ElevenLabs EU residency / Zero Retention** — verify it's available on my plan and switch it on.
- The only laptop-bound piece is **recording online meetings via Plaud Desktop** (needs the Mac in the call). Access, sync, and processing are all laptop-independent once deployed.

## Links

- Plaud MCP: https://docs.plaud.ai/documentation/plaud_app/mcp · server `mcp.plaud.ai`
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- ElevenLabs Scribe: https://elevenlabs.io/speech-to-text · API docs: https://elevenlabs.io/docs/api-reference/speech-to-text · pricing: https://elevenlabs.io/pricing/api
- Plaud Desktop: https://www.plaud.ai/pages/plaud-desktop
