# Engram Phase 1 — Plaud Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull recordings from a normal (non-Unlimited) Plaud account into Engram via Plaud's private `api.plaud.ai` using a pasted session token, dedup + incrementally, and run them through the existing Phase 0 pipeline — triggered by a manual button and a scheduled Railway cron.

**Architecture:** A small clean-room `lib/plaud` client (HTTP + typed mapping) and a `syncPlaud` orchestrator that reuses Phase 0's R2 storage and `runTranscription`/`runEnhancement`. A `/api/sync` route runs the sync, authorized by either a logged-in session (manual "Sync now") or a `CRON_SECRET` bearer (cron). A `requireSession`-guarded Settings page stores the AES-encrypted token and shows sync status.

**Tech Stack:** Next.js 16 (App Router) + TS, pnpm, Drizzle + postgres.js, Vitest. Reuses existing `lib/storage` (R2), `lib/pipeline`, `lib/crypto/secrets`, `lib/auth-guard`, `auth.ts`.

**Spec:** `docs/superpowers/specs/2026-06-22-engram-phase-1-plaud-sync-design.md`

## Global Constraints

- **pnpm only.** Conventional commits. Code clean/modern/performant/efficient.
- **Next.js 16** — `proxy.ts` not `middleware.ts`; dynamic `params` is `Promise<{...}>` and awaited; read `node_modules/next/dist/docs/` before Next-specific code.
- **Root-level layout** (no `src/`); `@/* → ./*`.
- **TDD** where a test is specified: failing test → run red → implement → run green → commit. Run focused test while iterating; full `pnpm test` before commit.
- **Clean-room:** do NOT copy Riffado (AGPL) or other projects' code. Implement our own client. The exact Plaud endpoint *paths* and raw field names are unknown until observed against `web.plaud.ai`; they live in ONE place (path constants + mapping functions) and are finalized in the deferred live-verify step. Unit tests use fixtures and mocked `fetch`, so they don't depend on real endpoints.
- **No live Plaud/DB/keys in the build env.** Build + unit-test only. Live smokes (token validate, list, download/transcribe) are deferred and explicitly marked.
- **Reuse, don't reinvent:** R2 via `getStorage()`/`buildAudioKey`, pipeline via `runTranscription`/`runEnhancement`, encryption via `encryptSecret`/`decryptSecret`, session via `auth.api.getSession`/`requireSession`.

## File Structure

```
lib/plaud/
  types.ts          # PlaudRecording / PlaudRecordingDetail + mapRecording(s)
  client.ts         # api.plaud.ai HTTP client (paths, auth header, fetch, download)
  credentials.ts    # save/get/has Plaud token (AES via api_credentials)
  sync.ts           # selectNewRecordings (pure) + syncPlaud orchestrator
  client.test.ts    # mapping + auth-header + error-mapping unit tests
  sync.test.ts      # selection + orchestration unit tests
app/api/sync/route.ts            # POST: session OR CRON_SECRET → syncPlaud
app/api/plaud/token/route.ts     # POST save token (session); GET connection status
app/settings/page.tsx            # requireSession; renders PlaudSettings
app/settings/plaud-settings.tsx  # client: token form, status, Sync now, last result
lib/config.ts        # + cronSecret(), plaudApiBase()
db/schema.ts         # sync_state += lastResult jsonb
app/layout.tsx       # + Settings nav link
drizzle/             # new migration (sync_state.last_result)
```

---

### Task 1: Config + `sync_state.lastResult` migration

**Files:**
- Modify: `lib/config.ts`, `db/schema.ts`
- Create: migration in `drizzle/`
- Test: `lib/config.test.ts`

**Interfaces:**
- Produces: `config.cronSecret(): string` (required env `CRON_SECRET`); `config.plaudApiBase(): string` (env `PLAUD_API_BASE`, default `https://api.plaud.ai`). `syncState.lastResult` jsonb typed `SyncResult | null` where `SyncResult = { ranAt: string; newCount: number; skippedCount: number; failedCount: number; error?: string }`.

- [ ] **Step 1: Write the failing test**

`lib/config.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { config } from "./config";

afterEach(() => { delete process.env.PLAUD_API_BASE; });

describe("config additions", () => {
  it("plaudApiBase defaults to api.plaud.ai", () => {
    expect(config.plaudApiBase()).toBe("https://api.plaud.ai");
  });
  it("plaudApiBase honors override", () => {
    process.env.PLAUD_API_BASE = "https://api.eu.plaud.ai";
    expect(config.plaudApiBase()).toBe("https://api.eu.plaud.ai");
  });
  it("cronSecret throws when unset", () => {
    delete process.env.CRON_SECRET;
    expect(() => config.cronSecret()).toThrow(/CRON_SECRET/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test lib/config.test.ts`
Expected: FAIL (`config.plaudApiBase is not a function`).

- [ ] **Step 3: Add the config getters**

In `lib/config.ts`, add inside the `config` object (after `llmModel`):
```ts
  llmModel: () => process.env.LLM_MODEL ?? "gpt-5.4-mini-2026-03-17",
  cronSecret: () => required("CRON_SECRET"),
  plaudApiBase: () => process.env.PLAUD_API_BASE ?? "https://api.plaud.ai",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test lib/config.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Add `lastResult` to `sync_state` schema**

In `db/schema.ts`, `jsonb` is already imported. Replace the `syncState` table with:
```ts
export const syncState = pgTable("sync_state", {
  id: uuid("id").primaryKey().defaultRandom(),
  lastCursor: text("last_cursor"),
  lastSyncedAt: timestamp("last_synced_at"),
  lastResult: jsonb("last_result").$type<{
    ranAt: string;
    newCount: number;
    skippedCount: number;
    failedCount: number;
    error?: string;
  }>(),
});
```

- [ ] **Step 6: Generate the migration**

Run: `pnpm db:generate`
Expected: a new `drizzle/0002_*.sql` adding `last_result jsonb` to `sync_state`. Do NOT run `db:migrate` (no DB here; applied on deploy).

- [ ] **Step 7: Typecheck + full tests**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: clean + all green.

- [ ] **Step 8: Commit**

```bash
git add lib/config.ts lib/config.test.ts db/schema.ts drizzle/
git commit -m "feat: add cron/plaud config and sync_state.lastResult column"
```

---

### Task 2: Plaud API client + types

**Files:**
- Create: `lib/plaud/types.ts`, `lib/plaud/client.ts`
- Test: `lib/plaud/client.test.ts`

**Interfaces:**
- Consumes: `config.plaudApiBase()`.
- Produces:
  - `PlaudRecording = { fileId: string; name: string; startAt: string; startAtMs: number; durationMs?: number; trashed: boolean }`
  - `PlaudRecordingDetail = PlaudRecording & { audioUrl: string }`
  - `mapRecording(raw: any): PlaudRecording`, `mapRecordingDetail(raw: any): PlaudRecordingDetail`
  - `class PlaudAuthError extends Error`
  - `listRecordings(token: string): Promise<PlaudRecording[]>`
  - `getRecordingDetail(token: string, fileId: string): Promise<PlaudRecordingDetail>`
  - `downloadAudio(signedUrl: string): Promise<{ bytes: Buffer; contentType: string }>`
  - `validateToken(token: string): Promise<boolean>`

- [ ] **Step 1: Write `lib/plaud/types.ts`**

```ts
export interface PlaudRecording {
  fileId: string;
  name: string;
  startAt: string;   // ISO 8601
  startAtMs: number; // epoch ms — checkpoint comparison key
  durationMs?: number;
  trashed: boolean;
}

export interface PlaudRecordingDetail extends PlaudRecording {
  audioUrl: string; // signed, ~24h
}

// Tolerant mapping: Plaud's raw field names are confirmed against web.plaud.ai
// during the live-verify step; we read the most likely keys with fallbacks so
// the shape is resilient and finalizing it is a one-file change.
export function mapRecording(raw: any): PlaudRecording {
  const startRaw = raw.start_at ?? raw.start_time ?? raw.created_at;
  const startAtMs = typeof startRaw === "number" ? startRaw : Date.parse(startRaw);
  return {
    fileId: String(raw.id ?? raw.file_id),
    name: raw.name ?? raw.title ?? "Untitled",
    startAt: new Date(startAtMs).toISOString(),
    startAtMs,
    durationMs: typeof raw.duration === "number" ? raw.duration : undefined,
    trashed: Boolean(raw.is_trash ?? raw.trashed ?? raw.is_deleted ?? false),
  };
}

export function mapRecordingDetail(raw: any): PlaudRecordingDetail {
  return { ...mapRecording(raw), audioUrl: raw.presigned_url ?? raw.url ?? raw.audio_url };
}
```

- [ ] **Step 2: Write the failing test**

`lib/plaud/client.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { mapRecording, mapRecordingDetail } from "./types";

afterEach(() => { vi.restoreAllMocks(); delete process.env.PLAUD_API_BASE; });

describe("mapRecording", () => {
  it("maps raw fields and computes startAtMs", () => {
    const r = mapRecording({ id: "f1", name: "Sync", start_at: "2026-06-01T10:00:00Z", duration: 65000 });
    expect(r).toMatchObject({ fileId: "f1", name: "Sync", durationMs: 65000, trashed: false });
    expect(r.startAtMs).toBe(Date.parse("2026-06-01T10:00:00Z"));
  });
  it("falls back across field-name variants and detects trashed", () => {
    const r = mapRecording({ file_id: 2, start_time: "2026-06-02T00:00:00Z", is_trash: true });
    expect(r.fileId).toBe("2");
    expect(r.name).toBe("Untitled");
    expect(r.trashed).toBe(true);
  });
  it("mapRecordingDetail picks the signed audio url", () => {
    const d = mapRecordingDetail({ id: "f1", start_at: "2026-06-01T10:00:00Z", presigned_url: "https://signed/a.mp3" });
    expect(d.audioUrl).toBe("https://signed/a.mp3");
  });
});

describe("client http", () => {
  it("listRecordings sends bearer auth and maps results", async () => {
    const { listRecordings } = await import("./client");
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "f1", start_at: "2026-06-01T10:00:00Z" }] }), { status: 200 }),
    );
    const res = await listRecordings("eyJ-token");
    expect(res).toHaveLength(1);
    expect(res[0].fileId).toBe("f1");
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer eyJ-token");
  });
  it("normalizes a token that already has a bearer prefix", async () => {
    const { listRecordings } = await import("./client");
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    await listRecordings("bearer eyJ-token");
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("bearer eyJ-token");
  });
  it("throws PlaudAuthError on 401", async () => {
    const { listRecordings, PlaudAuthError } = await import("./client");
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("nope", { status: 401 }));
    await expect(listRecordings("bad")).rejects.toBeInstanceOf(PlaudAuthError);
  });
  it("throws on other non-ok responses", async () => {
    const { listRecordings } = await import("./client");
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));
    await expect(listRecordings("t")).rejects.toThrow(/500/);
  });
  it("validateToken returns false on auth error", async () => {
    const { validateToken } = await import("./client");
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("nope", { status: 401 }));
    expect(await validateToken("bad")).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test lib/plaud/client.test.ts`
Expected: FAIL (`Cannot find module './client'`); the `mapRecording` tests already pass.

- [ ] **Step 4: Write `lib/plaud/client.ts`**

```ts
import { config } from "@/lib/config";
import { mapRecording, mapRecordingDetail, type PlaudRecording, type PlaudRecordingDetail } from "./types";

export class PlaudAuthError extends Error {}

// Endpoint paths — CONFIRM against web.plaud.ai network calls in the live-verify
// step. They are isolated here so finalizing them is a one-file change. Tests mock
// fetch and do not depend on these exact strings.
const PATHS = {
  currentUser: "/user/profile",
  listFiles: "/file/list",
  fileDetail: (id: string) => `/file/detail?id=${encodeURIComponent(id)}`,
};

function authHeaders(token: string): Record<string, string> {
  const t = token.trim();
  const value = t.toLowerCase().startsWith("bearer ") ? t : `Bearer ${t}`;
  return { Authorization: value, "Content-Type": "application/json" };
}

async function plaudFetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${config.plaudApiBase()}${path}`, {
    ...init,
    headers: { ...authHeaders(token), ...(init.headers as Record<string, string> ?? {}) },
  });
  if (res.status === 401 || res.status === 403) {
    throw new PlaudAuthError(`Plaud token rejected (${res.status}) — reconnect needed`);
  }
  if (!res.ok) throw new Error(`Plaud API ${path} failed: ${res.status} ${await res.text()}`);
  return res;
}

// Plaud list responses wrap items under data/list/files depending on endpoint;
// read the first array we find (finalized in live-verify).
function extractArray(json: any): any[] {
  if (Array.isArray(json)) return json;
  return json.data ?? json.list ?? json.files ?? json.items ?? [];
}

export async function listRecordings(token: string): Promise<PlaudRecording[]> {
  const res = await plaudFetch(token, PATHS.listFiles);
  return extractArray(await res.json()).map(mapRecording);
}

export async function getRecordingDetail(token: string, fileId: string): Promise<PlaudRecordingDetail> {
  const res = await plaudFetch(token, PATHS.fileDetail(fileId));
  const json = await res.json();
  return mapRecordingDetail(json.data ?? json);
}

export async function downloadAudio(signedUrl: string): Promise<{ bytes: Buffer; contentType: string }> {
  const res = await fetch(signedUrl); // presigned — no auth header
  if (!res.ok) throw new Error(`audio download failed: ${res.status}`);
  return {
    bytes: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get("content-type") ?? "audio/mpeg",
  };
}

export async function validateToken(token: string): Promise<boolean> {
  try {
    await plaudFetch(token, PATHS.currentUser);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test lib/plaud/client.test.ts`
Expected: all green.

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm exec tsc --noEmit
git add lib/plaud/types.ts lib/plaud/client.ts lib/plaud/client.test.ts
git commit -m "feat: add clean-room Plaud API client and typed mapping"
```

---

### Task 3: Token credentials store + sync orchestrator

**Files:**
- Create: `lib/plaud/credentials.ts`, `lib/plaud/sync.ts`
- Test: `lib/plaud/sync.test.ts`

**Interfaces:**
- Consumes: `db`, `recordings`/`syncState`/`apiCredentials`, `getStorage`/`buildAudioKey`, `runTranscription`/`runEnhancement`, `encryptSecret`/`decryptSecret`, the Task 2 client.
- Produces:
  - `savePlaudToken(token: string): Promise<void>`, `getPlaudToken(): Promise<string | null>`, `hasPlaudToken(): Promise<boolean>` (in `credentials.ts`).
  - `selectNewRecordings(all: PlaudRecording[], checkpointMs: number, existingFileIds: Set<string>): PlaudRecording[]`
  - `type SyncResult = { ranAt: string; newCount: number; skippedCount: number; failedCount: number; error?: string }`
  - `syncPlaud(): Promise<SyncResult>`

- [ ] **Step 1: Write `lib/plaud/credentials.ts`**

```ts
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apiCredentials } from "@/db/schema";
import { encryptSecret, decryptSecret } from "@/lib/crypto/secrets";

const PROVIDER = "plaud";

export async function savePlaudToken(token: string): Promise<void> {
  const ciphertext = encryptSecret(token.trim());
  await db
    .insert(apiCredentials)
    .values({ provider: PROVIDER, ciphertext })
    .onConflictDoUpdate({ target: apiCredentials.provider, set: { ciphertext } });
}

export async function getPlaudToken(): Promise<string | null> {
  const row = await db.query.apiCredentials.findFirst({ where: eq(apiCredentials.provider, PROVIDER) });
  return row ? decryptSecret(row.ciphertext) : null;
}

export async function hasPlaudToken(): Promise<boolean> {
  const row = await db.query.apiCredentials.findFirst({ where: eq(apiCredentials.provider, PROVIDER) });
  return Boolean(row);
}
```

- [ ] **Step 2: Write the failing test (pure selection + orchestration)**

`lib/plaud/sync.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PlaudRecording } from "./types";

function rec(p: Partial<PlaudRecording> & { fileId: string; startAtMs: number }): PlaudRecording {
  return { name: p.fileId, startAt: new Date(p.startAtMs).toISOString(), trashed: false, ...p };
}

describe("selectNewRecordings", () => {
  it("keeps untrashed, newer-than-checkpoint, not-already-present, sorted ascending", async () => {
    const { selectNewRecordings } = await import("./sync");
    const all = [
      rec({ fileId: "old", startAtMs: 100 }),
      rec({ fileId: "dup", startAtMs: 300 }),
      rec({ fileId: "trash", startAtMs: 400, trashed: true }),
      rec({ fileId: "b", startAtMs: 500 }),
      rec({ fileId: "a", startAtMs: 250 }),
    ];
    const out = selectNewRecordings(all, 200, new Set(["dup"]));
    expect(out.map((r) => r.fileId)).toEqual(["a", "b"]);
  });
});

// Orchestration: mock all IO collaborators.
const calls: any = { stored: [], inserted: [], transcribed: [], enhanced: [], syncStateSet: [] };
vi.mock("./client", () => ({
  PlaudAuthError: class PlaudAuthError extends Error {},
  listRecordings: vi.fn(),
  getRecordingDetail: vi.fn(async (_t: string, id: string) => ({
    fileId: id, name: id, startAt: "x", startAtMs: 0, trashed: false, audioUrl: `https://signed/${id}`,
  })),
  downloadAudio: vi.fn(async () => ({ bytes: Buffer.from("x"), contentType: "audio/mpeg" })),
}));
vi.mock("./credentials", () => ({ getPlaudToken: vi.fn(async () => "token") }));
vi.mock("@/lib/storage", () => ({
  getStorage: () => ({ put: vi.fn(async (k: string) => { calls.stored.push(k); }) }),
  buildAudioKey: (id: string, f: string) => `audio/${id}.${f.split(".").pop()}`,
}));
vi.mock("@/lib/pipeline", () => ({
  runTranscription: vi.fn(async (id: string) => { calls.transcribed.push(id); }),
  runEnhancement: vi.fn(async (id: string) => { calls.enhanced.push(id); }),
}));
vi.mock("@/db", () => ({
  db: {
    insert: () => ({ values: () => ({ returning: async () => { const id = `rec-${calls.inserted.length}`; calls.inserted.push(id); return [{ id }]; } }) }),
    update: () => ({ set: (v: any) => ({ where: async () => { calls.syncStateSet.push(v); } }) }),
    query: {
      recordings: { findMany: async () => calls.existing ?? [] },
      syncState: { findFirst: async () => calls.syncRow ?? { id: "s1", lastSyncedAt: null, lastResult: null } },
    },
  },
}));

beforeEach(() => {
  calls.stored = []; calls.inserted = []; calls.transcribed = []; calls.enhanced = [];
  calls.syncStateSet = []; calls.existing = []; calls.syncRow = { id: "s1", lastSyncedAt: null, lastResult: null };
});

describe("syncPlaud", () => {
  it("ingests new recordings through the pipeline and advances the checkpoint", async () => {
    const client = await import("./client");
    (client.listRecordings as any).mockResolvedValueOnce([
      { fileId: "f1", name: "One", startAt: "x", startAtMs: 1000, trashed: false },
      { fileId: "f2", name: "Two", startAt: "x", startAtMs: 2000, trashed: false },
    ]);
    const { syncPlaud } = await import("./sync");
    const result = await syncPlaud();
    expect(result.newCount).toBe(2);
    expect(result.failedCount).toBe(0);
    expect(calls.transcribed).toHaveLength(2);
    expect(calls.enhanced).toHaveLength(2);
    // checkpoint advanced to max startAt (2000) and lastResult written
    const lastSet = calls.syncStateSet.at(-1);
    expect(new Date(lastSet.lastSyncedAt).getTime()).toBe(2000);
    expect(lastSet.lastResult.newCount).toBe(2);
  });

  it("skips trashed + already-present and counts skips", async () => {
    calls.existing = [{ plaudFileId: "f1" }];
    const client = await import("./client");
    (client.listRecordings as any).mockResolvedValueOnce([
      { fileId: "f1", name: "dup", startAt: "x", startAtMs: 1000, trashed: false },
      { fileId: "f2", name: "trash", startAt: "x", startAtMs: 2000, trashed: true },
      { fileId: "f3", name: "new", startAt: "x", startAtMs: 3000, trashed: false },
    ]);
    const { syncPlaud } = await import("./sync");
    const result = await syncPlaud();
    expect(result.newCount).toBe(1);
    expect(result.skippedCount).toBe(2);
    expect(calls.transcribed).toEqual(["rec-0"]);
  });

  it("on PlaudAuthError records reconnect-needed and does NOT advance the checkpoint", async () => {
    const client = await import("./client");
    (client.listRecordings as any).mockRejectedValueOnce(new client.PlaudAuthError("401"));
    const { syncPlaud } = await import("./sync");
    const result = await syncPlaud();
    expect(result.error).toMatch(/reconnect/i);
    const lastSet = calls.syncStateSet.at(-1);
    expect(lastSet.lastSyncedAt).toBeUndefined(); // only lastResult written, not checkpoint
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test lib/plaud/sync.test.ts`
Expected: FAIL (`Cannot find module './sync'`).

- [ ] **Step 4: Write `lib/plaud/sync.ts`**

```ts
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { recordings, syncState } from "@/db/schema";
import { getStorage, buildAudioKey } from "@/lib/storage";
import { runTranscription, runEnhancement } from "@/lib/pipeline";
import { getPlaudToken } from "./credentials";
import { listRecordings, getRecordingDetail, downloadAudio, PlaudAuthError } from "./client";
import type { PlaudRecording } from "./types";

export interface SyncResult {
  ranAt: string;
  newCount: number;
  skippedCount: number;
  failedCount: number;
  error?: string;
}

export function selectNewRecordings(
  all: PlaudRecording[],
  checkpointMs: number,
  existingFileIds: Set<string>,
): PlaudRecording[] {
  return all
    .filter((r) => !r.trashed)
    .filter((r) => r.startAtMs > checkpointMs)
    .filter((r) => !existingFileIds.has(r.fileId))
    .sort((a, b) => a.startAtMs - b.startAtMs);
}

function extFromContentType(ct: string): string {
  if (ct.includes("mp4") || ct.includes("m4a") || ct.includes("aac")) return "m4a";
  if (ct.includes("wav")) return "wav";
  if (ct.includes("ogg") || ct.includes("opus")) return "ogg";
  return "mp3";
}

async function getSyncRow() {
  let row = await db.query.syncState.findFirst();
  if (!row) {
    [row] = await db.insert(syncState).values({}).returning();
  }
  return row;
}

export async function syncPlaud(): Promise<SyncResult> {
  const ranAt = new Date().toISOString();
  const base: SyncResult = { ranAt, newCount: 0, skippedCount: 0, failedCount: 0 };

  const token = await getPlaudToken();
  if (!token) {
    const result = { ...base, error: "not connected — paste a Plaud token in Settings" };
    await writeResult(result);
    return result;
  }

  const row = await getSyncRow();
  const checkpointMs = row.lastSyncedAt ? new Date(row.lastSyncedAt).getTime() : 0;

  let all: PlaudRecording[];
  try {
    all = await listRecordings(token);
  } catch (e) {
    const error = e instanceof PlaudAuthError ? "reconnect needed — Plaud token rejected" : (e as Error).message;
    const result = { ...base, error };
    await writeResult(result); // NOTE: checkpoint not advanced
    return result;
  }

  const existing = await db.query.recordings.findMany();
  const existingFileIds = new Set(existing.map((r: any) => r.plaudFileId).filter(Boolean) as string[]);

  const candidates = selectNewRecordings(all, checkpointMs, existingFileIds);
  const skippedCount = all.length - candidates.length;

  let newCount = 0;
  let failedCount = 0;
  let maxStartMs = checkpointMs;

  for (const r of candidates) {
    try {
      const detail = await getRecordingDetail(token, r.fileId);
      const { bytes, contentType } = await downloadAudio(detail.audioUrl);
      const [rec] = await db
        .insert(recordings)
        .values({
          title: r.name,
          source: "plaud",
          storageKey: "pending",
          contentType,
          durationSeconds: r.durationMs ? Math.round(r.durationMs / 1000) : null,
          plaudFileId: r.fileId,
        })
        .returning();
      const key = buildAudioKey(rec.id, `x.${extFromContentType(contentType)}`);
      await getStorage().put(key, bytes, contentType);
      await db.update(recordings).set({ storageKey: key }).where(eq(recordings.id, rec.id));

      await runTranscription(rec.id);
      const stored = await db.query.recordings.findFirst({ where: eq(recordings.id, rec.id) });
      if (stored?.status === "transcribed") await runEnhancement(rec.id);

      newCount++;
      if (r.startAtMs > maxStartMs) maxStartMs = r.startAtMs;
    } catch {
      failedCount++;
    }
  }

  const result: SyncResult = { ranAt, newCount, skippedCount, failedCount };
  // advance checkpoint only after the batch completes
  await db.update(syncState).set({ lastSyncedAt: new Date(maxStartMs), lastResult: result }).where(eq(syncState.id, row.id));
  return result;
}

async function writeResult(result: SyncResult) {
  const row = await getSyncRow();
  await db.update(syncState).set({ lastResult: result }).where(eq(syncState.id, row.id));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test lib/plaud/sync.test.ts`
Expected: all green. (The orchestration test mocks `db`, `client`, `storage`, `pipeline`, `credentials`.)

- [ ] **Step 6: Typecheck + full tests + commit**

```bash
pnpm exec tsc --noEmit && pnpm test
git add lib/plaud/credentials.ts lib/plaud/sync.ts lib/plaud/sync.test.ts
git commit -m "feat: add Plaud token store and incremental sync orchestrator"
```

---

### Task 4: API routes (`/api/sync`, `/api/plaud/token`)

**Files:**
- Create: `app/api/sync/route.ts`, `app/api/plaud/token/route.ts`
- Test: `app/api/sync/auth.test.ts`

**Interfaces:**
- Consumes: `auth`, `config.cronSecret`, `syncPlaud`, `savePlaudToken`/`hasPlaudToken`, `validateToken`.
- Produces: `POST /api/sync` (session OR `CRON_SECRET` bearer → runs sync, returns `SyncResult`; 401 otherwise). `POST /api/plaud/token` (session; body `{ token }` → save; 400 if missing/invalid-looking). `GET /api/plaud/token` (session → `{ connected: boolean }`). Exports a testable `isAuthorized(req: Request): Promise<boolean>` from the sync route module.

- [ ] **Step 1: Read the Next.js 16 route-handler doc**

Run: `ls node_modules/next/dist/docs/` and confirm the route-handler signature + that `request.headers` is a standard `Headers`. Use the same `auth.api.getSession({ headers: request.headers })` pattern already in `app/api/recordings/route.ts`.

- [ ] **Step 2: Write the failing auth test**

`app/api/sync/auth.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("@/lib/plaud/sync", () => ({ syncPlaud: vi.fn(async () => ({ ranAt: "x", newCount: 0, skippedCount: 0, failedCount: 0 })) }));

beforeEach(() => { process.env.CRON_SECRET = "s3cret"; });

function req(headers: Record<string, string>) {
  return new Request("http://localhost/api/sync", { method: "POST", headers });
}

describe("isAuthorized", () => {
  it("accepts a matching CRON_SECRET bearer without a session", async () => {
    const { isAuthorized } = await import("./route");
    expect(await isAuthorized(req({ authorization: "Bearer s3cret" }))).toBe(true);
  });
  it("rejects a wrong secret and no session", async () => {
    const { auth } = await import("@/auth");
    (auth.api.getSession as any).mockResolvedValueOnce(null);
    const { isAuthorized } = await import("./route");
    expect(await isAuthorized(req({ authorization: "Bearer wrong" }))).toBe(false);
  });
  it("accepts a valid session with no secret header", async () => {
    const { auth } = await import("@/auth");
    (auth.api.getSession as any).mockResolvedValueOnce({ user: { id: "u1" } });
    const { isAuthorized } = await import("./route");
    expect(await isAuthorized(req({}))).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test app/api/sync/auth.test.ts`
Expected: FAIL (`Cannot find module './route'`).

- [ ] **Step 4: Write `app/api/sync/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncPlaud } from "@/lib/plaud/sync";

// Authorized if the request carries the cron shared-secret OR a valid session.
// Reads CRON_SECRET via process.env directly so a missing secret doesn't throw
// in environments that only use the session path.
export async function isAuthorized(request: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const authz = request.headers.get("authorization");
  if (secret && authz === `Bearer ${secret}`) return true;
  const session = await auth.api.getSession({ headers: request.headers });
  return Boolean(session);
}

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await syncPlaud();
  return NextResponse.json(result);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test app/api/sync/auth.test.ts`
Expected: 3 passed.

- [ ] **Step 6: Write `app/api/plaud/token/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { savePlaudToken, hasPlaudToken } from "@/lib/plaud/credentials";
import { validateToken } from "@/lib/plaud/client";

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ connected: await hasPlaudToken() });
}

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { token } = (await request.json()) as { token?: string };
  const trimmed = token?.trim();
  if (!trimmed || trimmed.length < 20) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }
  // Best-effort validation; still save (lets the user save even if validate is flaky).
  const valid = await validateToken(trimmed);
  await savePlaudToken(trimmed);
  return NextResponse.json({ connected: true, valid });
}
```

- [ ] **Step 7: Typecheck + full tests + commit**

```bash
pnpm exec tsc --noEmit && pnpm test
git add app/api/sync app/api/plaud
git commit -m "feat: add /api/sync (session-or-cron) and Plaud token routes"
```

---

### Task 5: Settings page UI

**Files:**
- Create: `app/settings/page.tsx`, `app/settings/plaud-settings.tsx`
- Modify: `app/layout.tsx` (nav link to `/settings`)

**Interfaces:**
- Consumes: `requireSession`, `hasPlaudToken`, `db`/`syncState` (read `lastResult`), the `/api/plaud/token` + `/api/sync` routes.

- [ ] **Step 1: Server page `app/settings/page.tsx`**

```tsx
import { requireSession } from "@/lib/auth-guard";
import { db } from "@/db";
import { PlaudSettings } from "./plaud-settings";
import { hasPlaudToken } from "@/lib/plaud/credentials";

export default async function SettingsPage() {
  await requireSession();
  const connected = await hasPlaudToken();
  const sync = await db.query.syncState.findFirst();
  return (
    <main className="mx-auto max-w-2xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Instellingen</h1>
      <PlaudSettings connected={connected} lastResult={sync?.lastResult ?? null} />
    </main>
  );
}
```

- [ ] **Step 2: Client component `app/settings/plaud-settings.tsx`**

```tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type LastResult = { ranAt: string; newCount: number; skippedCount: number; failedCount: number; error?: string } | null;

export function PlaudSettings({ connected, lastResult }: { connected: boolean; lastResult: LastResult }) {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function saveToken() {
    setBusy(true); setStatus(null);
    try {
      const res = await fetch("/api/plaud/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "kon token niet opslaan");
      setToken("");
      setStatus(json.valid ? "Token opgeslagen en geldig." : "Token opgeslagen (kon niet valideren).");
    } catch (e) { setStatus((e as Error).message); } finally { setBusy(false); }
  }

  async function syncNow() {
    setBusy(true); setStatus("Bezig met synchroniseren…");
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "sync mislukt");
      setStatus(json.error ? `Sync: ${json.error}` : `Sync klaar — ${json.newCount} nieuw, ${json.skippedCount} overgeslagen, ${json.failedCount} mislukt.`);
    } catch (e) { setStatus((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <section className="space-y-4">
      <div className="space-y-2">
        <h2 className="font-medium">Plaud-koppeling</h2>
        <p className="text-sm text-muted-foreground">
          Status: {connected ? "verbonden" : "niet verbonden"}. Plak je sessietoken van web.plaud.ai (localStorage <code>tokenstr</code>).
        </p>
        <div className="flex gap-2">
          <Input type="password" placeholder="bearer eyJ…" value={token} onChange={(e) => setToken(e.target.value)} />
          <Button onClick={saveToken} disabled={busy || token.trim().length < 20}>Opslaan</Button>
        </div>
      </div>

      <div className="space-y-2">
        <Button onClick={syncNow} disabled={busy || !connected}>Nu synchroniseren</Button>
        {lastResult && (
          <p className="text-sm text-muted-foreground">
            Laatste sync: {new Date(lastResult.ranAt).toLocaleString("nl-BE")} — {lastResult.error ?? `${lastResult.newCount} nieuw, ${lastResult.skippedCount} overgeslagen, ${lastResult.failedCount} mislukt`}
          </p>
        )}
      </div>

      {status && <p className="text-sm">{status}</p>}
    </section>
  );
}
```

- [ ] **Step 3: Add the nav link in `app/layout.tsx`**

In the header nav (next to the existing Upload/recordings links), add:
```tsx
<a href="/settings" className="hover:underline">Instellingen</a>
```
Match the existing nav link markup/styling in `layout.tsx` exactly (read the file first; reuse its classes).

- [ ] **Step 4: Typecheck + tests + manual note**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: clean + green. UI is verified by typecheck + the deferred live run (no new automated UI tests).

- [ ] **Step 5: Commit**

```bash
git add app/settings app/layout.tsx
git commit -m "feat: add Settings page for Plaud token + manual sync"
```

---

### Task 6: Env + cron wiring + docs

**Files:**
- Modify: `.env.example`, `DEPLOY.md`, `railway.json`, `PROGRESS.md`

**Interfaces:**
- Produces: `CRON_SECRET` + `PLAUD_API_BASE` documented; Railway cron config invoking `POST /api/sync` with the secret.

- [ ] **Step 1: Add env vars to `.env.example`**

Append (with placeholder comments):
```
# Plaud sync (Phase 1)
PLAUD_API_BASE=https://api.plaud.ai
CRON_SECRET=run: openssl rand -hex 32
```

- [ ] **Step 2: Configure the Railway cron**

In `railway.json`, add a cron entry (verify the current Railway cron schema against Railway docs; if the field differs, document the manual dashboard step in `DEPLOY.md` instead of committing a wrong field). Intended shape:
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "deploy": { "preDeployCommand": ["pnpm db:migrate"] },
  "cron": [{ "schedule": "*/15 * * * *", "command": "curl -fsS -X POST \"$RAILWAY_PUBLIC_DOMAIN/api/sync\" -H \"Authorization: Bearer $CRON_SECRET\"" }]
}
```
If Railway cron is configured via the dashboard rather than `railway.json`, leave `railway.json` as-is and write the exact dashboard steps in `DEPLOY.md` (schedule `*/15 * * * *`, `curl -X POST https://<domain>/api/sync -H "Authorization: Bearer <CRON_SECRET>"`).

- [ ] **Step 3: Update `DEPLOY.md`**

Add a "Phase 1 — Plaud sync" section: set `PLAUD_API_BASE` (default fine) and `CRON_SECRET` (generate with `openssl rand -hex 32`) in Railway; how to grab the Plaud token from `web.plaud.ai` (`localStorage.getItem("tokenstr")`); paste it in Settings; the cron schedule; and the deferred live-verify steps (validate token + list now; download/transcribe after the first real recording, which finalizes the endpoint paths/field names in `lib/plaud/client.ts` + `lib/plaud/types.ts`).

- [ ] **Step 4: Update `PROGRESS.md`**

Check off the Phase 1 roadmap items that are now built (OAuth→token, sync client, scheduled worker via cron) and leave the live-verify + device-onboarding items as pending human steps. Note the MCP→private-API pivot and link the spec.

- [ ] **Step 5: Typecheck + tests + commit**

```bash
pnpm exec tsc --noEmit && pnpm test
git add .env.example DEPLOY.md railway.json PROGRESS.md
git commit -m "chore: wire CRON_SECRET/PLAUD_API_BASE, Railway cron, and Phase 1 docs"
```

---

## Self-Review

**Spec coverage:**
- Paste-token auth + AES storage → Task 3 (`credentials.ts`) + Task 4 (token route) + Task 5 (UI). ✓
- `api.plaud.ai` client (list/detail/download/validate) → Task 2. ✓
- Incremental checkpoint (`start_time`) + `plaud_file_id` dedup + trashed filter + checkpoint-after-batch → Task 3 (`selectNewRecordings` + `syncPlaud`). ✓
- Re-transcribe with Scribe, reuse pipeline → Task 3 (`runTranscription`/`runEnhancement`). ✓
- Manual button + cron, session-or-`CRON_SECRET` gate → Task 4 (`isAuthorized`) + Task 5 (button) + Task 6 (cron). ✓
- `sync_state.lastResult` migration → Task 1. ✓
- Settings page, `requireSession`, never echo token → Task 5. ✓
- Security: `CRON_SECRET`, encrypted token, guarded routes → Tasks 1/3/4/6. ✓
- Clean-room endpoint isolation + deferred field finalization → Task 2 (PATHS + tolerant mapping) + Task 6 docs. ✓
- Out-of-scope items (OTP login, import Plaud transcripts, device onboarding) correctly absent. ✓

**Placeholder scan:** No "TBD/handle errors" instructions. The Plaud endpoint paths and Railway-cron schema are explicitly flagged verify-points with concrete defaults and a named finalization step — not vague placeholders; tests don't depend on them.

**Type consistency:** `PlaudRecording`/`PlaudRecordingDetail` shared from `lib/plaud/types.ts` (Task 2) and consumed in Task 3. `SyncResult` shape identical across `sync.ts` (Task 3), the sync route (Task 4), schema `lastResult` `$type` (Task 1), and the Settings `LastResult` type (Task 5). `savePlaudToken`/`getPlaudToken`/`hasPlaudToken`, `listRecordings`/`getRecordingDetail`/`downloadAudio`/`validateToken`, `selectNewRecordings`/`syncPlaud`, `isAuthorized` names consistent across tasks. `recordings` insert uses real columns (`source`, `plaudFileId`, `storageKey`, `durationSeconds`, `contentType`). Pipeline reuse matches the real `runTranscription`/`runEnhancement` signatures and the transcribe→`status==='transcribed'`→enhance pattern from `app/api/recordings/[id]/transcribe/route.ts`.
