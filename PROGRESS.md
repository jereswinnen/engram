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
- [ ] Task 10: Deploy to Railway
  - [x] `railway.json` with `preDeployCommand` (`pnpm db:migrate`)
  - [x] `DEPLOY.md` runbook with exact commands
  - [x] `.env.example` complete (all 12 required vars)
  - [x] `package.json` `engines` field (`>=20.9.0`)
  - [ ] **HUMAN STEP**: Provision Railway project + Postgres plugin
  - [ ] **HUMAN STEP**: Create Cloudflare R2 bucket + API token
  - [ ] **HUMAN STEP**: Set all env vars in Railway dashboard
  - [ ] **HUMAN STEP**: Trigger first deploy; confirm migrations apply in build logs
  - [ ] **HUMAN STEP**: Seed admin user (`pnpm dlx tsx scripts/seed-user.ts`), then delete the script + redeploy
  - [ ] **HUMAN STEP**: Smoke test — R2 round-trip
  - [ ] **HUMAN STEP**: Smoke test — ElevenLabs Scribe on Dutch sample
  - [ ] **HUMAN STEP**: Smoke test — OpenAI enhancement
  - [ ] **HUMAN STEP**: Full phone end-to-end acceptance test

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
