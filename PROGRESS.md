# Engram Phase 0 — Build Progress

## Checklist

- [x] Task 1: Scaffold Next.js 16 + pnpm + Vitest + shadcn
- [x] Task 2: Drizzle schema + migration + config loader
- [x] Task 3: AES-256-GCM secret encryption
- [x] Task 4: R2 storage layer
- [x] Task 5: ElevenLabs Scribe transcription adapter
- [x] Task 6: LLM enhancement layer (Vercel AI SDK)
- [x] Task 7: Pipeline route handlers
- [x] Task 8: Minimal UI
- [x] Task 9: Better Auth (single-user, no email)
- [x] Task 10: Deploy to Railway — **LIVE & VALIDATED**
  - [x] `railway.json` with `preDeployCommand` (`pnpm db:migrate`)
  - [x] `DEPLOY.md` runbook with exact commands
  - [x] `.env.example` complete (all 12 required vars)
  - [x] `package.json` `engines` field (`>=20.9.0`)
  - [x] Provisioned Railway project + Postgres plugin
  - [x] Created Cloudflare R2 bucket + API token
  - [x] Set all env vars in Railway dashboard
  - [x] First deploy; migrations applied (all 11 tables created)
  - [x] Seeded admin user; seed script removed (commit 5a822f1)
  - [x] Logged in on live URL
  - [x] Full phone end-to-end acceptance test PASSED (upload Dutch clip → diarized transcript → Dutch summary → playback). This validated the R2, Scribe, and OpenAI live paths together.

**✅ PHASE 0 COMPLETE.** Next milestone: Phase 1 — Plaud MCP sync (see roadmap below).

## Remaining Roadmap (post Phase 0)

> Phase 0 code is complete and merged to `main`. Phase 1 is now complete (env vars + cron
> wiring + docs). See `DEPLOY.md` Section "Phase 1 — Plaud sync" for the full user guide.

### Phase 1 — Plaud MCP sync + real device (makes capture automatic)

**Design:** Phase 1 uses the **official Plaud MCP** (`mcp.plaud.ai`) with interactive OAuth
(no paste token). This provides a clean, standards-based integration with Plaud's recorder
network. Full design + plan in
[Phase 1 MCP spec](docs/superpowers/specs/2026-06-22-engram-phase-1-plaud-mcp-design.md) and
[Phase 1 MCP plan](docs/superpowers/plans/2026-06-22-engram-phase-1-plaud-mcp.md).

#### Implementation (COMPLETE)

- [x] **MCP client + SDK** — Plaud MCP transport layer, tool definitions, response types.
      (`lib/plaud/mcp/` + SDK integration)
- [x] **OAuth auth** — interactive authorize → callback → encrypted credentials storage in
      `api_credentials`. (`lib/plaud/oauth.ts`, `app/api/plaud/callback/route.ts`, Settings UI)
- [x] **MCP client methods** — `listFiles`, `getFile`, `downloadAudio` via Plaud MCP tools;
      client tolerant of response-field variance until real data validates mapping.
      (`lib/plaud/client.ts`)
- [x] **Sync orchestration** — checkpoint on `startAtMs`, dedup on `fileId`, skip trashed,
      per-item error isolation, reuse Phase 0 pipeline (Scribe + LLM).
      (`lib/plaud/sync.ts` + `app/api/sync/route.ts`)
- [x] **Cron auth gate** — `/api/sync` authorized by session (manual button) **or**
      `CRON_SECRET` bearer header (cron); else 401. (`app/api/sync/auth.test.ts`)
- [x] **Env var** — `CRON_SECRET` (required, generated).
      (`.env.example`, `railway.json` ready for dashboard cron config, `DEPLOY.md` step-by-step)
- [x] **Settings UI** — OAuth connect/disconnect button, show connection status, manual
      "Sync now" button, last-sync result (counts + timestamp + error state).
      (`app/settings/page.tsx`)

#### Verification (DEFERRED, human steps)

- [ ] **OAuth authorize + list working live** — In Settings click "Verbind met Plaud",
      complete OAuth authorize, confirm "Verbonden" status and "Sync now" returns 0 new
      without error = ready.
- [ ] **Full download + transcribe + enhance** — Sync after your first real Plaud recording.
      Validates end-to-end MCP→download→transcribe→enhance pipeline and finalizes response
      field mappings in `lib/plaud/mcp/types.ts` and `lib/plaud/client.ts` (client is tolerant
      until then).
- [ ] **Device onboarding** — enable Plaud Private Cloud Sync + Wi-Fi charging-sync on your
      device; verify Desktop app → cloud → Engram → enhanced summary flow. (Out of scope for
      Phase 1, deferred to Phase 2 device story.)

### Phase 1+ — deferred UX features

- [ ] Waveform player (Wavesurfer.js) + click-to-seek between transcript and audio
- [ ] Full-text search across all transcripts
- [ ] Export: JSON / TXT / SRT-VTT subtitles / one-click full backup
- [ ] Browser notifications when a recording finishes (no email — per project decision)

### Phase 2 — closer to "Plaud Intelligence"

- [ ] Multi-view / role-specific summaries (schema already allows multiple `ai_enhancements` rows per recording)
- [ ] Template library (`templates` table = name + prompt + optional output schema)
- [ ] Mind maps (prompt → hierarchical JSON → markmap/react-flow)
- [ ] Ask-Engram (RAG): chunk → embed → `pgvector` → retrieve → answer with citations to word timestamps
- [ ] Glossary/jargon: Scribe keyterm prompting or an LLM post-edit pass
- [ ] Native iOS client (SwiftUI/SwiftData) against Engram's REST API

### Known minor follow-ups (non-blocking, from code review)

- [ ] `/upload` page has no server-side session guard (harmless — client component, upload API is 401-guarded); add `requireSession()` for consistency
- [ ] Crypto hardening (optional): `parts.length !== 3` guard in `decryptSecret`; IV-tamper + wrong-key-length test cases
- [ ] Retries insert new `transcriptions`/`ai_enhancements` rows rather than upserting (reads now `orderBy createdAt desc`, so newest wins — dedupe if it ever matters)

## Next.js 16 Gotchas

These were discovered while reading `node_modules/next/dist/docs/` and apply to all subsequent tasks:

### Async Request APIs (breaking — all of Next.js 16)

`cookies()`, `headers()`, `draftMode()` must be awaited. `params` and `searchParams`
are Promises in page/layout/route handlers — `await params` before destructuring.
The synchronous compatibility shim from Next.js 15 is fully removed.

```ts
// Route handler with dynamic segment — Next.js 16
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params  // must await
}

// Page with searchParams — Next.js 16
export default async function Page(props: PageProps<'/blog/[slug]'>) {
  const { slug } = await props.params
  const query   = await props.searchParams
}
```

### `middleware` → `proxy` (renamed)

The `middleware.ts` filename and `middleware` named export are deprecated.
Use `proxy.ts` with a `proxy` export instead.
The `edge` runtime is NOT supported in `proxy`; it runs Node.js only.

### `revalidateTag` now requires a second `cacheLife` profile argument

```ts
// Next.js 15 (broken in 16)
revalidateTag('posts')
// Next.js 16
revalidateTag('posts', 'max')
```

Use `updateTag` (Server Actions only) for immediate cache expiry.

### `cacheLife` / `cacheTag` — `unstable_` prefix removed

```ts
import { cacheLife, cacheTag } from 'next/cache'  // no unstable_ prefix
```

### Turbopack is the default bundler (Next.js 16)

`next dev` and `next build` both use Turbopack. No flag needed.
Custom `webpack` configs will cause `next build` to fail unless `--webpack` is passed.
Move `experimental.turbopack` options to the top-level `turbopack` key in `next.config.ts`.

### `next lint` command removed

Use `eslint` (or `biome`) directly. `next build` no longer runs linting.

### `serverRuntimeConfig` / `publicRuntimeConfig` removed

Access env vars directly in Server Components, or use `NEXT_PUBLIC_` prefix for
client-accessible values. Use `connection()` to force runtime reads.

### Parallel Routes — `default.js` required

All `@slot` parallel-route directories now require an explicit `default.js` file
or builds will fail.

### `next dev` output goes to `.next/dev/`

Dev server and production build use separate output dirs. Turbopack trace path:
`.next/dev/trace-turbopack`

### Project layout note

This project was pre-scaffolded without `--src-dir`; `app/`, `lib/`, `components/`,
`hooks/` live at the repo root. `@/*` maps to `./*` in `tsconfig.json`.
Vitest is configured to pick up `**/*.test.ts` (excluding `node_modules` and `.next`).
