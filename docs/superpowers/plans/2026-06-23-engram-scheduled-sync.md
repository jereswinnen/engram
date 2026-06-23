# Engram Scheduled Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the existing Plaud sync (which already does transcription + enhancement) automatically every hour via a Railway cron service, with a self-healing concurrency guard so scheduled and manual runs can't overlap and double-import.

**Architecture:** The `/api/sync` endpoint + `CRON_SECRET` bearer auth already exist. Add (1) a `runningSince` lock to `syncPlaud`, (2) a deps-free `scripts/sync-cron.mjs` the Railway cron service runs to POST that endpoint, (3) DEPLOY docs for the one-time Railway cron-service setup.

**Tech Stack:** Next.js 16 + TS, pnpm, Drizzle + postgres.js, Node (built-in `fetch`), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-23-engram-scheduled-sync-design.md`

## Global Constraints

- **pnpm only.** Conventional commits. Clean/modular code.
- **No new runtime deps** — the cron script uses Node's built-in `fetch` (no tsx/curl), so a pruned prod install can't break it.
- **`APP_URL` is the public `https://…` URL** (the `CRON_SECRET` bearer protects the endpoint).
- Lock TTL = **30 minutes** (self-heals after a crashed run). Schedule = **hourly** (`0 * * * *`).
- **No DB applied here** — `pnpm db:generate` only (Railway's preDeploy `db:migrate` applies it).

## File Structure

```
db/schema.ts                 # + syncState.runningSince; align lastResult $type
drizzle/                     # migration (ADD COLUMN running_since)
lib/plaud/sync.ts            # concurrency guard + SyncResult.note
lib/plaud/sync.test.ts       # guard tests + fix .at(-1) assertions
scripts/sync-cron.mjs        # deps-free POST /api/sync with the bearer
package.json                 # + "sync:cron" script
DEPLOY.md , PROGRESS.md      # Railway cron-service setup + progress
```

---

### Task 1: `runningSince` concurrency guard in `syncPlaud`

**Files:**
- Modify: `db/schema.ts`, `lib/plaud/sync.ts`, `lib/plaud/sync.test.ts`
- Create: migration

**Interfaces:**
- `SyncResult` gains `note?: string` (set only when a run is skipped). `syncState` gains `runningSince` (timestamp, nullable).

- [ ] **Step 1: Add the column to `db/schema.ts`**

In the `syncState` table add `runningSince`, and align the `lastResult` `$type` with the real `SyncResult` (it's currently missing `deferredCount`):
```ts
export const syncState = pgTable("sync_state", {
  id: uuid("id").primaryKey().defaultRandom(),
  lastCursor: text("last_cursor"),
  lastSyncedAt: timestamp("last_synced_at"),
  runningSince: timestamp("running_since"),
  lastResult: jsonb("last_result").$type<{
    ranAt: string;
    newCount: number;
    skippedCount: number;
    failedCount: number;
    deferredCount: number;
    error?: string;
  }>(),
});
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate` → confirm a new `drizzle/000N_*.sql` containing `ALTER TABLE "sync_state" ADD COLUMN "running_since" timestamp;`. Do NOT run `db:migrate`.

- [ ] **Step 3: Write the failing tests**

In `lib/plaud/sync.test.ts`: the `beforeEach` mock sync row needs the new field, and the existing `.at(-1)` assertions must become field-filtered (the new `finally` clears `runningSince` as the *last* `syncState` write, so `.at(-1)` is no longer the checkpoint write).

Add this helper near the top of the `describe("syncPlaud", …)` block (or module scope):
```ts
// The mock db.update() pushes every set() into calls.syncStateSet (recording + syncState writes).
// Find the last syncState write carrying a given key.
const lastWriteWith = (key: string) => calls.syncStateSet.filter((s: any) => key in s).at(-1);
```
Update `beforeEach` so the default sync row includes `runningSince: null`:
```ts
calls.syncRow = { id: "s1", lastSyncedAt: null, lastResult: null, runningSince: null };
```
Change the existing checkpoint/result assertions from `calls.syncStateSet.at(-1)` to the filtered lookup, e.g.:
- ingest test: `expect(new Date(lastWriteWith("lastSyncedAt").lastSyncedAt).getTime()).toBe(2000);` and `expect(lastWriteWith("lastResult").lastResult.newCount).toBe(2);`
- checkpoint test: `expect(new Date(lastWriteWith("lastSyncedAt").lastSyncedAt).getTime()).toBe(1999);`
- the "connect throws" / "not connected" tests: `expect(lastWriteWith("lastSyncedAt")).toBeUndefined();` (still no checkpoint write).

Add three new tests:
```ts
it("skips when a sync is already running (recent runningSince), without processing", async () => {
  calls.syncRow = { id: "s1", lastSyncedAt: null, lastResult: null, runningSince: new Date() };
  calls.files = [{ fileId: "f1", name: "One", startAtMs: 1000, trashed: false }];
  const { syncPlaud } = await import("./sync");
  const result = await syncPlaud();
  expect(result.note).toMatch(/already running/i);
  expect(calls.transcribed).toHaveLength(0);
  expect(lastWriteWith("lastResult")).toBeUndefined(); // skip does not overwrite lastResult
  expect(lastWriteWith("runningSince")).toBeUndefined(); // lock not touched on skip
});

it("proceeds when runningSince is stale (older than the 30-min TTL)", async () => {
  calls.syncRow = { id: "s1", lastSyncedAt: null, lastResult: null, runningSince: new Date(Date.now() - 31 * 60 * 1000) };
  calls.files = [{ fileId: "f1", name: "One", startAtMs: 1000, trashed: false }];
  const { syncPlaud } = await import("./sync");
  const result = await syncPlaud();
  expect(result.newCount).toBe(1);
  expect(lastWriteWith("runningSince").runningSince).toBeNull(); // cleared in finally
});

it("clears runningSince in finally even when not connected", async () => {
  calls.connected = false;
  const { syncPlaud } = await import("./sync");
  await syncPlaud();
  expect(lastWriteWith("runningSince").runningSince).toBeNull(); // lock acquired then cleared
});
```

- [ ] **Step 4: Run tests → fail**

Run: `pnpm test lib/plaud/sync.test.ts`
Expected: FAIL (no `note`, no guard, `runningSince` writes absent).

- [ ] **Step 5: Implement the guard in `lib/plaud/sync.ts`**

Add `note?: string` to the `SyncResult` interface:
```ts
export interface SyncResult {
  ranAt: string;
  newCount: number;
  skippedCount: number;
  failedCount: number;
  deferredCount: number;
  note?: string; // set only when a run is skipped (e.g. already running)
  error?: string;
}
```
Wrap the body of `syncPlaud` (everything after `getSyncRow`) in the lock. Replace from the `const row = await getSyncRow();` line through the end of the function with:
```ts
  const row = await getSyncRow();

  // Concurrency guard: don't let a scheduled run overlap a manual/previous one
  // (which would double-import + double-pay). Self-heals after the TTL if a run crashed.
  const LOCK_TTL_MS = 30 * 60 * 1000;
  if (row.runningSince && Date.now() - new Date(row.runningSince).getTime() < LOCK_TTL_MS) {
    return { ...base, note: "skipped — a sync is already running" };
  }
  await db.update(syncState).set({ runningSince: new Date() }).where(eq(syncState.id, row.id));

  try {
    if (!(await isConnected())) {
      const result = { ...base, error: "not connected — connect Plaud in Settings" };
      await writeResult(row.id, result);
      return result;
    }

    const checkpointMs = row.lastSyncedAt ? new Date(row.lastSyncedAt).getTime() : 0;

    let client;
    try {
      client = await connect();
    } catch (e) {
      console.error("[plaud sync] connect failed", e);
      const result = { ...base, error: "reconnect needed — Plaud authorization expired" };
      await writeResult(row.id, result);
      return result;
    }

    try {
      // …the entire existing list/select/ingest body, unchanged, ending with `return result;`…
    } finally {
      await client.close();
    }
  } finally {
    await db.update(syncState).set({ runningSince: null }).where(eq(syncState.id, row.id));
  }
}
```
Keep the existing inner logic verbatim — only (a) move `checkpointMs` inside the outer try (it was already after the connect; keep its current position), (b) nest the existing `client`/main `try…finally` inside the new outer `try…finally`. The outer `finally` clearing `runningSince` runs on every path (early returns + throws). Do not change `getSyncRow`/`writeResult`.

- [ ] **Step 6: Run tests → pass; typecheck; commit**

Run: `pnpm test lib/plaud/sync.test.ts && pnpm exec tsc --noEmit`
Expected: all sync tests green (existing + 3 new).
```bash
git add db/schema.ts drizzle/ lib/plaud/sync.ts lib/plaud/sync.test.ts
git commit -m "feat: add self-healing concurrency guard to Plaud sync"
```

---

### Task 2: `sync-cron.mjs` trigger script

**Files:**
- Create: `scripts/sync-cron.mjs`
- Modify: `package.json`

**Interfaces:**
- Run as `node scripts/sync-cron.mjs` (the Railway cron service's start command). Reads `APP_URL` + `CRON_SECRET` from env.

- [ ] **Step 1: Create `scripts/sync-cron.mjs`**

```js
// Triggers the app's hourly Plaud sync. Run by the Railway cron service:
//   node scripts/sync-cron.mjs
// Requires env: APP_URL (public https URL of the web app) and CRON_SECRET.
const appUrl = process.env.APP_URL;
const secret = process.env.CRON_SECRET;

if (!appUrl || !secret) {
  console.error("sync-cron: APP_URL and CRON_SECRET must both be set");
  process.exit(1);
}

const url = `${appUrl.replace(/\/+$/, "")}/api/sync`;

try {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.json().catch(() => ({}));
  console.log(`sync-cron: POST ${url} -> ${res.status} ${JSON.stringify(body)}`);
  // Fail the run (non-zero exit → Railway marks it red) on transport/HTTP/sync errors.
  // A skipped run (body.note, no error) and a normal run exit 0.
  if (!res.ok || body.error) process.exit(1);
  process.exit(0);
} catch (e) {
  console.error("sync-cron: request failed", e instanceof Error ? e.message : String(e));
  process.exit(1);
}
```
(Top-level `await` is valid in an `.mjs` ESM module; Node 18+ provides global `fetch`.)

- [ ] **Step 2: Add the package script**

In `package.json` `"scripts"`, add:
```json
    "sync:cron": "node scripts/sync-cron.mjs"
```

- [ ] **Step 3: Typecheck + tests + commit**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: clean + green (no test changes; `.mjs` is outside tsc's `include`, verify it doesn't get picked up — if tsconfig globs `**/*`, ensure `scripts` isn't type-checked or the file is plain JS that passes).
```bash
git add scripts/sync-cron.mjs package.json
git commit -m "feat: add deps-free sync-cron trigger script"
```

---

### Task 3: Deploy docs + PROGRESS

**Files:**
- Modify: `DEPLOY.md`, `PROGRESS.md`

- [ ] **Step 1: Add the Railway cron-service section to `DEPLOY.md`**

Add a section documenting the one-time setup:
```markdown
## Scheduled sync (Railway cron service)

New recordings (and their transcription + AI enhancement) are picked up
automatically by an hourly cron service that calls `POST /api/sync`.

One-time setup:
1. Generate a strong random secret and set `CRON_SECRET` on the **web** service.
2. In the same Railway project, **New → Service → from the same GitHub repo**.
3. On that service: **Settings → Cron Schedule = `0 * * * *`**;
   **Start Command = `node scripts/sync-cron.mjs`**.
4. Set its env vars: `CRON_SECRET` (same value as the web service) and
   `APP_URL` = the web app's public URL (e.g. `https://engram-production.up.railway.app`).
5. Save. Railway runs it hourly; it POSTs `/api/sync` then exits. Run history
   and logs appear on that service; the sync outcome also shows in Settings.

A run that overlaps an in-progress sync is skipped (the `runningSince` guard);
a crashed run self-heals after 30 minutes.
```

- [ ] **Step 2: Update `PROGRESS.md`** — note scheduled/automated sync is implemented (hourly Railway cron service + concurrency guard); link the spec `docs/superpowers/specs/2026-06-23-engram-scheduled-sync-design.md`; note the one-time Railway setup is performed by the operator.

- [ ] **Step 3: Typecheck + suite + commit**

Run: `pnpm exec tsc --noEmit && pnpm test`
```bash
git add DEPLOY.md PROGRESS.md
git commit -m "docs: document the Railway cron service for scheduled sync"
```

---

## Self-Review

**Spec coverage:** hourly Railway cron service → Task 3 (docs) + Task 2 (script the service runs). Deps-free trigger via the existing `CRON_SECRET` endpoint → Task 2. `runningSince` self-healing lock (skip-if-recent, set-at-start, clear-in-finally, 30-min TTL) + `SyncResult.note` + skip-doesn't-write-lastResult → Task 1. Migration → Task 1. Public `https` `APP_URL` → Task 2/3. Tests (skip / stale-proceeds / finally-clears) → Task 1. Observability (lastResult + Railway logs) → unchanged/Task 3. All spec sections covered.

**Placeholder scan:** The Task-1 Step-5 inner body is intentionally referenced as "the entire existing body, unchanged" with explicit nesting instructions rather than re-pasting ~40 lines verbatim — the implementer keeps the current code and only wraps it; this is a precise modify-in-place instruction, not a vague placeholder. No "TODO/handle errors" prose.

**Type consistency:** `SyncResult` (Task 1) gains `note?`; `syncState.runningSince` (Task 1) read in the guard + cleared in `finally`; the test helper `lastWriteWith` matches the mock's generic `db.update().set()` recording. `scripts/sync-cron.mjs` (Task 2) consumes `APP_URL`/`CRON_SECRET` env + the existing `/api/sync` (no code dependency on Task 1's types). `lastResult` `$type` aligned with `SyncResult` (minus `note`, which is skip-only and never written to `lastResult`).
