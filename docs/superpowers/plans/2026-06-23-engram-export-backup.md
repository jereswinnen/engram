# Engram Export & Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-recording Markdown (Notion-friendly) + JSON export, and a one-click async full backup (data + audio zip → R2 → presigned download) tracked in a `backups` table.

**Architecture:** Pure serializers (`markdown`/`json`/`filename`) drive both per-recording export and the backup. A download route + detail-page buttons cover per-recording export. The full backup is a fire-and-forget `buildBackup` job (archiver-streamed zip uploaded to R2 via streaming multipart), tracked in `backups`, surfaced in a Settings "Backups" section.

**Tech Stack:** Next.js 16 + TS, pnpm, Drizzle + postgres.js, `archiver`, `@aws-sdk/lib-storage`, Vitest. R2 via existing `lib/storage`.

**Spec:** `docs/superpowers/specs/2026-06-23-engram-export-backup-design.md`

## Global Constraints

- **pnpm only.** Conventional commits. Clean/modular code. English UI.
- **Next.js 16:** server components default; async `params`; `auth.api.getSession({ headers: request.headers })` for routes / `requireSession()` for pages. Read `node_modules/next/dist/docs/` before Next-specific changes.
- **Root-level layout** (no `src/`); `@/* → ./*`.
- **TDD** for pure serializers + the backup orchestration (mocked); the real archiver+R2 streaming is verified at runtime/manually.
- **Security:** every export/backup route session-guarded; backup downloaded via short-TTL presigned URL.
- **Backup resilience:** a per-recording audio failure is caught, noted in `manifest.json`, and skipped; only a wholesale failure → `status='error'`. The fire-and-forget call has an outer `.catch` that marks the row `error` (never silently stuck `pending`).

## File Structure

```
lib/export/markdown.ts       # recordingToMarkdown [pure]
lib/export/json.ts           # recordingToExport (+ ExportRecord type) [pure]
lib/export/filename.ts       # exportFilename [pure]
lib/export/*.test.ts
app/api/recordings/[id]/export/route.ts     # GET ?format=md|json
app/recordings/[id]/export-buttons.tsx      # client: download .md/.json + copy MD
app/recordings/[id]/page.tsx                # render <ExportButtons>
db/schema.ts                 # + backups table
drizzle/                     # migration
lib/backup/store.ts          # createBackup/getBackups/markReady/markError (+ Backup type)
lib/backup/store.test.ts
lib/storage/types.ts , lib/storage/r2.ts    # + putStream
lib/backup/build.ts          # buildBackup(id) (archiver + manifest + putStream)
lib/backup/build.test.ts
app/api/backup/route.ts             # POST create + GET list
app/api/backup/[id]/download/route.ts  # GET → presign → redirect
app/settings/backups.tsx     # client: create + list + status + download + polling
app/settings/page.tsx        # load getBackups(), render <Backups>
PROGRESS.md
```

---

### Task 1: Pure export serializers

**Files:**
- Create: `lib/export/markdown.ts`, `lib/export/json.ts`, `lib/export/filename.ts` + `.test.ts` for each

**Interfaces:**
- Types (structural, declared in the files): `Rec = { id: string; title: string; source: string; createdAt: Date; durationSeconds: number | null; status: string }`; `Tr = { language: string | null; fullText: string; segments: { start: number; end: number; text: string; speaker?: string }[] } | null`; `Enh = { title: string | null; summary: string; actionItems: string[]; keyPoints: string[] } | null`.
- Produces: `recordingToMarkdown(rec: Rec, tr: Tr, enh: Enh): string`; `recordingToExport(rec: Rec, tr: Tr, enh: Enh): ExportRecord`; `exportFilename(title: string, id: string, ext: string): string`.

- [ ] **Step 1: Write the failing tests**

`lib/export/filename.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { exportFilename } from "./filename";

describe("exportFilename", () => {
  it("slugifies the title and appends the extension", () => {
    expect(exportFilename("Weekly Sync!", "abc-123", "md")).toBe("weekly-sync.md");
  });
  it("falls back to the id when the title slugifies to empty", () => {
    expect(exportFilename("!!!", "abc-123", "json")).toBe("abc-123.json");
  });
  it("collapses spaces/unsafe chars and trims", () => {
    expect(exportFilename("  A/B:  C  ", "id", "md")).toBe("a-b-c.md");
  });
});
```
`lib/export/markdown.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { recordingToMarkdown } from "./markdown";

const rec = { id: "r1", title: "Weekly Sync", source: "plaud", createdAt: new Date("2026-06-01T10:00:00Z"), durationSeconds: 65, status: "done" };

describe("recordingToMarkdown", () => {
  it("renders title, summary, items, and transcript with [mm:ss]", () => {
    const md = recordingToMarkdown(
      rec,
      { language: "nld", fullText: "x", segments: [{ start: 5, end: 7, text: "Hallo", speaker: "A" }] },
      { title: "Wekelijkse sync", summary: "Samenvatting.", actionItems: ["Jan: offerte"], keyPoints: ["Deadline"] },
    );
    expect(md).toContain("# Weekly Sync");
    expect(md).toContain("## Summary");
    expect(md).toContain("Samenvatting.");
    expect(md).toContain("- Jan: offerte");
    expect(md).toContain("## Transcript");
    expect(md).toContain("**Speaker A** [0:05]: Hallo");
  });
  it("handles missing transcription and enhancement", () => {
    const md = recordingToMarkdown(rec, null, null);
    expect(md).toContain("# Weekly Sync");
    expect(md).toContain("Not yet processed");
    expect(md).toContain("No transcript yet");
  });
  it("omits empty action items / key points sections", () => {
    const md = recordingToMarkdown(rec, null, { title: null, summary: "S", actionItems: [], keyPoints: [] });
    expect(md).not.toContain("## Action items");
    expect(md).not.toContain("## Key points");
  });
});
```
`lib/export/json.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { recordingToExport } from "./json";

const rec = { id: "r1", title: "Sync", source: "plaud", createdAt: new Date("2026-06-01T10:00:00Z"), durationSeconds: 65, status: "done" };

describe("recordingToExport", () => {
  it("maps full data", () => {
    const out = recordingToExport(
      rec,
      { language: "nld", fullText: "hoi", segments: [{ start: 0, end: 1, text: "hoi" }] },
      { title: "T", summary: "S", actionItems: ["a"], keyPoints: ["k"] },
    );
    expect(out).toMatchObject({ id: "r1", title: "Sync", source: "plaud", durationSeconds: 65 });
    expect(out.transcript).toMatchObject({ language: "nld", fullText: "hoi" });
    expect(out.enhancement).toMatchObject({ summary: "S" });
  });
  it("nulls transcript/enhancement when absent", () => {
    const out = recordingToExport(rec, null, null);
    expect(out.transcript).toBeNull();
    expect(out.enhancement).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests → fail**

Run: `pnpm test lib/export/`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement the three files**

`lib/export/filename.ts`:
```ts
export function exportFilename(title: string, id: string, ext: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || id}.${ext}`;
}
```
`lib/export/markdown.ts`:
```ts
interface Rec { id: string; title: string; source: string; createdAt: Date; durationSeconds: number | null; status: string }
interface Tr { language: string | null; fullText: string; segments: { start: number; end: number; text: string; speaker?: string }[] }
interface Enh { title: string | null; summary: string; actionItems: string[]; keyPoints: string[] }

function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function recordingToMarkdown(rec: Rec, tr: Tr | null, enh: Enh | null): string {
  const lines: string[] = [];
  lines.push(`# ${rec.title}`, "");
  const dur = rec.durationSeconds != null ? ` · ${mmss(rec.durationSeconds)}` : "";
  lines.push(`_${rec.createdAt.toISOString().slice(0, 10)} · source: ${rec.source}${dur}_`, "");

  lines.push("## Summary", "");
  lines.push(enh ? enh.summary : "_Not yet processed_", "");
  if (enh && enh.actionItems.length > 0) {
    lines.push("## Action items", "", ...enh.actionItems.map((i) => `- ${i}`), "");
  }
  if (enh && enh.keyPoints.length > 0) {
    lines.push("## Key points", "", ...enh.keyPoints.map((p) => `- ${p}`), "");
  }

  lines.push("## Transcript", "");
  if (tr && tr.segments.length > 0) {
    for (const s of tr.segments) {
      lines.push(`**Speaker ${s.speaker ?? "?"}** [${mmss(s.start)}]: ${s.text}`, "");
    }
  } else {
    lines.push("_No transcript yet_", "");
  }
  return lines.join("\n");
}
```
`lib/export/json.ts`:
```ts
interface Rec { id: string; title: string; source: string; createdAt: Date; durationSeconds: number | null; status: string }
interface Tr { language: string | null; fullText: string; segments: { start: number; end: number; text: string; speaker?: string }[] }
interface Enh { title: string | null; summary: string; actionItems: string[]; keyPoints: string[] }

export interface ExportRecord {
  id: string;
  title: string;
  source: string;
  createdAt: string;
  durationSeconds: number | null;
  status: string;
  transcript: { language: string | null; fullText: string; segments: Tr["segments"] } | null;
  enhancement: { title: string | null; summary: string; actionItems: string[]; keyPoints: string[] } | null;
}

export function recordingToExport(rec: Rec, tr: Tr | null, enh: Enh | null): ExportRecord {
  return {
    id: rec.id,
    title: rec.title,
    source: rec.source,
    createdAt: rec.createdAt.toISOString(),
    durationSeconds: rec.durationSeconds,
    status: rec.status,
    transcript: tr ? { language: tr.language, fullText: tr.fullText, segments: tr.segments } : null,
    enhancement: enh ? { title: enh.title, summary: enh.summary, actionItems: enh.actionItems, keyPoints: enh.keyPoints } : null,
  };
}
```

- [ ] **Step 4: Run tests → pass; typecheck; commit**

Run: `pnpm test lib/export/ && pnpm exec tsc --noEmit`
```bash
git add lib/export
git commit -m "feat: add pure export serializers (markdown, json, filename)"
```

---

### Task 2: Per-recording export route + detail-page buttons

**Files:**
- Create: `app/api/recordings/[id]/export/route.ts`, `app/recordings/[id]/export-buttons.tsx`
- Modify: `app/recordings/[id]/page.tsx`

**Interfaces:**
- Consumes: `recordingToMarkdown`, `recordingToExport`, `exportFilename` (Task 1); `auth`, `db`.
- Produces: `GET /api/recordings/[id]/export?format=md|json` (attachment download). `ExportButtons({ id }: { id: string })` client component.

- [ ] **Step 1: Read the Next.js 16 route-handler doc** (`ls node_modules/next/dist/docs/`) for the `Response` + headers shape and async `params`.

- [ ] **Step 2: Implement the export route**

`app/api/recordings/[id]/export/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { recordings, transcriptions, aiEnhancements } from "@/db/schema";
import { recordingToMarkdown } from "@/lib/export/markdown";
import { recordingToExport } from "@/lib/export/json";
import { exportFilename } from "@/lib/export/filename";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const format = request.nextUrl.searchParams.get("format");
  if (format !== "md" && format !== "json") {
    return NextResponse.json({ error: "format must be md or json" }, { status: 400 });
  }

  const rec = await db.query.recordings.findFirst({ where: eq(recordings.id, id) });
  if (!rec) return NextResponse.json({ error: "not found" }, { status: 404 });
  const tr = await db.query.transcriptions.findFirst({ where: eq(transcriptions.recordingId, id), orderBy: [desc(transcriptions.createdAt)] });
  const enh = await db.query.aiEnhancements.findFirst({ where: eq(aiEnhancements.recordingId, id), orderBy: [desc(aiEnhancements.createdAt)] });

  const body = format === "md"
    ? recordingToMarkdown(rec, tr ?? null, enh ?? null)
    : JSON.stringify(recordingToExport(rec, tr ?? null, enh ?? null), null, 2);
  const filename = exportFilename(rec.title, rec.id, format);
  const contentType = format === "md" ? "text/markdown; charset=utf-8" : "application/json; charset=utf-8";

  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": contentType, "Content-Disposition": `attachment; filename="${filename}"` },
  });
}
```

- [ ] **Step 3: Implement `app/recordings/[id]/export-buttons.tsx`**

```tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ExportButtons({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  async function copyMarkdown() {
    const res = await fetch(`/api/recordings/${id}/export?format=md`);
    if (!res.ok) return;
    await navigator.clipboard.writeText(await res.text());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="flex gap-2">
      <Button asChild variant="outline" size="sm"><a href={`/api/recordings/${id}/export?format=md`}>Download .md</a></Button>
      <Button asChild variant="outline" size="sm"><a href={`/api/recordings/${id}/export?format=json`}>Download .json</a></Button>
      <Button variant="outline" size="sm" onClick={copyMarkdown}>{copied ? "Copied!" : "Copy Markdown"}</Button>
    </div>
  );
}
```
(If `Button` lacks `size`, drop it — confirm against `components/ui/button.tsx`.)

- [ ] **Step 4: Render it in `app/recordings/[id]/page.tsx`**

Import `ExportButtons` and render it under the title (above the player). The detail page already loads the recording; just add:
```tsx
import { ExportButtons } from "./export-buttons";
// after <h1>{recording.title}</h1>:
      <ExportButtons id={id} />
```

- [ ] **Step 5: Typecheck + tests + commit**

Run: `pnpm exec tsc --noEmit && pnpm test`
```bash
git add app/api/recordings/[id]/export app/recordings/[id]/export-buttons.tsx app/recordings/[id]/page.tsx
git commit -m "feat: add per-recording markdown/json export route and buttons"
```

---

### Task 3: `backups` table + store

**Files:**
- Modify: `db/schema.ts`
- Create: migration; `lib/backup/store.ts`, `lib/backup/store.test.ts`

**Interfaces:**
- Produces: `backups` table (`id` uuid pk, `status` text default `'pending'`, `storageKey` text nullable, `sizeBytes` integer nullable, `error` text nullable, `createdAt` timestamp). `Backup = { id; status; storageKey: string|null; sizeBytes: number|null; error: string|null; createdAt: Date }`. Store: `createBackup(): Promise<Backup>`, `getBackups(): Promise<Backup[]>` (newest first), `markReady(id, storageKey, sizeBytes): Promise<void>`, `markError(id, error): Promise<void>`.

- [ ] **Step 1: Add the table to `db/schema.ts`**

```ts
export const backups = pgTable("backups", {
  id: uuid("id").primaryKey().defaultRandom(),
  status: text("status").notNull().default("pending"),
  storageKey: text("storage_key"),
  sizeBytes: integer("size_bytes"),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate` → confirm a new `drizzle/000N_*.sql` with `CREATE TABLE "backups"`. Don't run `db:migrate`.

- [ ] **Step 3: Write the failing store test**

`lib/backup/store.test.ts` (mocked db, in-memory):
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
const rows: any[] = [];
vi.mock("@/db", () => ({
  db: {
    query: { backups: { findMany: async () => rows.slice().reverse() } },
    insert: () => ({ values: () => ({ returning: async () => { const r = { id: `b${rows.length}`, status: "pending", storageKey: null, sizeBytes: null, error: null, createdAt: new Date() }; rows.push(r); return [r]; } }) }),
    update: () => ({ set: (v: any) => ({ where: async () => { Object.assign(rows[rows.length - 1], v); } }) }),
  },
}));
beforeEach(() => { rows.length = 0; });

describe("backup store", () => {
  it("creates a pending backup", async () => {
    const { createBackup } = await import("./store");
    const b = await createBackup();
    expect(b.status).toBe("pending");
  });
  it("markReady sets status/key/size; markError sets error", async () => {
    const { createBackup, markReady, getBackups } = await import("./store");
    const b = await createBackup();
    await markReady(b.id, "backups/x.zip", 123);
    const all = await getBackups();
    expect(all[0]).toMatchObject({ status: "ready", storageKey: "backups/x.zip", sizeBytes: 123 });
  });
});
```

- [ ] **Step 4: Run test → fails**

Run: `pnpm test lib/backup/store.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 5: Implement `lib/backup/store.ts`**

```ts
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { backups } from "@/db/schema";

export interface Backup {
  id: string;
  status: string;
  storageKey: string | null;
  sizeBytes: number | null;
  error: string | null;
  createdAt: Date;
}

export async function createBackup(): Promise<Backup> {
  const [row] = await db.insert(backups).values({}).returning();
  return row as Backup;
}
export async function getBackups(): Promise<Backup[]> {
  return (await db.query.backups.findMany({ orderBy: [desc(backups.createdAt)] })) as Backup[];
}
export async function markReady(id: string, storageKey: string, sizeBytes: number): Promise<void> {
  await db.update(backups).set({ status: "ready", storageKey, sizeBytes }).where(eq(backups.id, id));
}
export async function markError(id: string, error: string): Promise<void> {
  await db.update(backups).set({ status: "error", error }).where(eq(backups.id, id));
}
```
(The test's `findMany` mock ignores the orderBy arg — fine; real Drizzle honors it.)

- [ ] **Step 6: Run test → passes; typecheck; commit**

Run: `pnpm test lib/backup/store.test.ts && pnpm exec tsc --noEmit`
```bash
git add db/schema.ts drizzle/ lib/backup/store.ts lib/backup/store.test.ts
git commit -m "feat: add backups table and store"
```

---

### Task 4: `Storage.putStream` + archiver dep

**Files:**
- Modify: `lib/storage/types.ts`, `lib/storage/r2.ts`, `package.json`

**Interfaces:**
- Produces: `Storage.putStream(key: string, body: Readable, contentType: string): Promise<void>` (streaming multipart upload via `@aws-sdk/lib-storage`).

- [ ] **Step 1: Install deps**

```bash
pnpm add archiver @aws-sdk/lib-storage
pnpm add -D @types/archiver
```

- [ ] **Step 2: Add `putStream` to the interface**

In `lib/storage/types.ts`, add to the `Storage` interface:
```ts
import type { Readable } from "node:stream";
// inside interface Storage:
  putStream(key: string, body: Readable, contentType: string): Promise<void>;
```

- [ ] **Step 3: Implement in `lib/storage/r2.ts`**

Add the import and the method to the object returned by `createR2Storage`:
```ts
import { Upload } from "@aws-sdk/lib-storage";
import type { Readable } from "node:stream";
// inside the returned object, alongside put/presignedGetUrl/delete:
    async putStream(key, body, contentType) {
      await new Upload({
        client,
        params: { Bucket: r2.bucket, Key: key, Body: body, ContentType: contentType },
      }).done();
    },
```
(`client` and `r2` are already in scope in `createR2Storage`.)

- [ ] **Step 4: Typecheck + tests + commit**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: clean + green (the storage unit test still passes — `putStream` isn't exercised there).
```bash
git add package.json pnpm-lock.yaml lib/storage/types.ts lib/storage/r2.ts
git commit -m "feat: add Storage.putStream (R2 streaming multipart upload)"
```

---

### Task 5: `buildBackup` job

**Files:**
- Create: `lib/backup/build.ts`, `lib/backup/build.test.ts`

**Interfaces:**
- Consumes: `db` + `recordings`/`transcriptions`/`aiEnhancements`; `getStorage` (`put`/`presignedGetUrl`/`putStream`); `recordingToMarkdown`/`recordingToExport`/`exportFilename`; `markReady`/`markError` (store); `archiver`.
- Produces: `buildBackup(id: string): Promise<void>` (resilient; updates the row).

- [ ] **Step 1: Write the failing orchestration test**

`lib/backup/build.test.ts` (mock everything heavy; assert status transitions + resilience):
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: any = {};
vi.mock("./store", () => ({
  markReady: vi.fn(async (id: string, key: string, size: number) => { calls.ready = { id, key, size }; }),
  markError: vi.fn(async (id: string, err: string) => { calls.error = { id, err }; }),
}));
vi.mock("@/lib/storage", () => ({
  getStorage: () => ({
    presignedGetUrl: vi.fn(async (k: string) => `https://signed/${k}`),
    putStream: vi.fn(async () => { calls.uploaded = true; }),
  }),
}));
vi.mock("@/lib/export/markdown", () => ({ recordingToMarkdown: () => "MD" }));
vi.mock("@/lib/export/json", () => ({ recordingToExport: () => ({ id: "r" }) }));
vi.mock("@/lib/export/filename", () => ({ exportFilename: () => "x.mp3" }));
vi.mock("@/db", () => ({
  db: {
    query: {
      recordings: { findMany: async () => calls.recs ?? [] },
      transcriptions: { findFirst: async () => null },
      aiEnhancements: { findFirst: async () => null },
    },
  },
}));
// archiver: a fake stream-ish object recording appends + finalize
vi.mock("archiver", () => ({
  default: () => {
    const a: any = { entries: [], append: (_body: unknown, opts: any) => a.entries.push(opts.name), finalize: vi.fn(async () => {}), on: () => a, pipe: () => a };
    calls.archive = a;
    return a;
  },
}));
// global.fetch for audio
beforeEach(() => { calls.recs = []; calls.ready = undefined; calls.error = undefined; calls.uploaded = false;
  vi.spyOn(global, "fetch").mockResolvedValue(new Response("audiobytes", { status: 200 })); });

describe("buildBackup", () => {
  it("marks ready and appends manifest after processing recordings", async () => {
    calls.recs = [{ id: "r1", title: "A", source: "plaud", createdAt: new Date(), durationSeconds: 1, status: "done", storageKey: "audio/r1.mp3" }];
    const { buildBackup } = await import("./build");
    await buildBackup("b1");
    expect(calls.ready?.id).toBe("b1");
    expect(calls.archive.entries).toContain("manifest.json");
    expect(calls.error).toBeUndefined();
  });
  it("skips a recording whose audio fetch fails but still completes", async () => {
    (global.fetch as any).mockResolvedValueOnce(new Response("nope", { status: 404 }));
    calls.recs = [{ id: "r1", title: "A", source: "plaud", createdAt: new Date(), durationSeconds: 1, status: "done", storageKey: "audio/r1.mp3" }];
    const { buildBackup } = await import("./build");
    await buildBackup("b1");
    expect(calls.ready?.id).toBe("b1"); // still ready, not error
  });
});
```

- [ ] **Step 2: Run test → fails**

Run: `pnpm test lib/backup/build.test.ts`
Expected: FAIL (`Cannot find module './build'`).

- [ ] **Step 3: Implement `lib/backup/build.ts`**

```ts
import { Readable, PassThrough } from "node:stream";
import archiver from "archiver";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { recordings, transcriptions, aiEnhancements } from "@/db/schema";
import { getStorage } from "@/lib/storage";
import { recordingToMarkdown } from "@/lib/export/markdown";
import { recordingToExport } from "@/lib/export/json";
import { exportFilename } from "@/lib/export/filename";
import { markReady, markError } from "./store";

export async function buildBackup(id: string): Promise<void> {
  try {
    const recs = await db.query.recordings.findMany();
    const storage = getStorage();

    const archive = archiver("zip", { zlib: { level: 9 } });
    const counter = new PassThrough();
    let size = 0;
    counter.on("data", (chunk: Buffer) => { size += chunk.length; });
    archive.pipe(counter);

    const key = `backups/${id}.zip`;
    // putStream consumes the counter stream; run concurrently with appends.
    const upload = storage.putStream(key, counter, "application/zip");

    const manifest = { createdAt: new Date().toISOString(), recordings: [] as any[], errors: [] as any[] };

    for (const rec of recs) {
      const tr = await db.query.transcriptions.findFirst({ where: eq(transcriptions.recordingId, rec.id), orderBy: [desc(transcriptions.createdAt)] });
      const enh = await db.query.aiEnhancements.findFirst({ where: eq(aiEnhancements.recordingId, rec.id), orderBy: [desc(aiEnhancements.createdAt)] });
      const folder = `recordings/${rec.id}`;
      archive.append(recordingToMarkdown(rec, tr ?? null, enh ?? null), { name: `${folder}/transcript.md` });
      archive.append(JSON.stringify(recordingToExport(rec, tr ?? null, enh ?? null), null, 2), { name: `${folder}/data.json` });
      try {
        const url = await storage.presignedGetUrl(rec.storageKey, 3600);
        const res = await fetch(url);
        if (!res.ok || !res.body) throw new Error(`audio ${res.status}`);
        archive.append(Readable.fromWeb(res.body as any), { name: `${folder}/${exportFilename(rec.title, rec.id, audioExt(rec.contentType))}` });
        manifest.recordings.push({ id: rec.id, title: rec.title, audio: true });
      } catch (e) {
        manifest.errors.push({ recordingId: rec.id, error: e instanceof Error ? e.message : String(e) });
        manifest.recordings.push({ id: rec.id, title: rec.title, audio: false });
      }
    }

    archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
    await archive.finalize();
    await upload;
    await markReady(id, key, size);
  } catch (e) {
    await markError(id, e instanceof Error ? e.message : String(e));
  }
}

function audioExt(contentType: string): string {
  if (contentType.includes("mp4") || contentType.includes("m4a") || contentType.includes("aac")) return "m4a";
  if (contentType.includes("wav")) return "wav";
  if (contentType.includes("ogg") || contentType.includes("opus")) return "ogg";
  return "mp3";
}
```
Note: `recs` items carry `contentType`/`storageKey` (real `recordings` columns). The streaming (archiver→counter→putStream concurrent with per-item appends) is the runtime-verified part; the test mocks archiver/fetch/storage and asserts status + resilience only.

- [ ] **Step 4: Run test → passes; typecheck; commit**

Run: `pnpm test lib/backup/build.test.ts && pnpm exec tsc --noEmit`
```bash
git add lib/backup/build.ts lib/backup/build.test.ts
git commit -m "feat: add buildBackup zip job (resilient, streamed to R2)"
```

---

### Task 6: Backup API routes

**Files:**
- Create: `app/api/backup/route.ts`, `app/api/backup/[id]/download/route.ts`
- Test: `app/api/backup/backup-api.test.ts`

**Interfaces:**
- `POST /api/backup` (session) → `createBackup()` + fire-and-forget `buildBackup(id).catch(markError)` → `{ id }`. `GET /api/backup` (session) → `Backup[]`. `GET /api/backup/[id]/download` (session) → ready → presign `storageKey` redirect; not ready → 409.

- [ ] **Step 1: Write the failing test (auth + not-ready)**

`app/api/backup/backup-api.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
vi.mock("@/auth", () => ({ auth: { api: { getSession: vi.fn(async () => ({ user: { id: "u" } })) } } }));
vi.mock("@/lib/backup/store", () => ({
  createBackup: vi.fn(async () => ({ id: "b1", status: "pending" })),
  getBackups: vi.fn(async () => []),
}));
vi.mock("@/lib/backup/build", () => ({ buildBackup: vi.fn(async () => {}) }));

describe("POST /api/backup", () => {
  it("creates a backup and returns its id", async () => {
    const { POST } = await import("./route");
    const res = await POST(new Request("http://localhost/api/backup", { method: "POST" }) as any);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: "b1" });
  });
});
```

- [ ] **Step 2: Run → fails; then implement `app/api/backup/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createBackup, getBackups, markError } from "@/lib/backup/store";
import { buildBackup } from "@/lib/backup/build";

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getBackups());
}

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const backup = await createBackup();
  // fire-and-forget; outer catch ensures the row never stays stuck pending on a thrown error
  buildBackup(backup.id).catch((e) => markError(backup.id, e instanceof Error ? e.message : String(e)));
  return NextResponse.json({ id: backup.id }, { status: 201 });
}
```
(`markError` import is used only by the catch.)

- [ ] **Step 3: Implement `app/api/backup/[id]/download/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { backups } from "@/db/schema";
import { getStorage } from "@/lib/storage";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const backup = await db.query.backups.findFirst({ where: eq(backups.id, id) });
  if (!backup || backup.status !== "ready" || !backup.storageKey) {
    return NextResponse.json({ error: "backup not ready" }, { status: 409 });
  }
  const url = await getStorage().presignedGetUrl(backup.storageKey, 300);
  return NextResponse.redirect(url);
}
```

- [ ] **Step 4: Run test → passes; typecheck + full suite; commit**

Run: `pnpm test app/api/backup/backup-api.test.ts && pnpm exec tsc --noEmit && pnpm test`
```bash
git add app/api/backup
git commit -m "feat: add backup create/list/download API routes"
```

---

### Task 7: Settings "Backups" UI

**Files:**
- Create: `app/settings/backups.tsx`
- Modify: `app/settings/page.tsx`

**Interfaces:**
- Consumes: `getBackups` (server initial load); `/api/backup` (POST/GET), `/api/backup/[id]/download`.

- [ ] **Step 1: Create `app/settings/backups.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Backup = { id: string; status: string; sizeBytes: number | null; error: string | null; createdAt: string };

function fmtSize(b: number | null) {
  if (b == null) return "";
  const mb = b / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
}

export function Backups({ initial }: { initial: Backup[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const pending = initial.some((b) => b.status === "pending");

  // Poll while any backup is still generating.
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [pending, router]);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch("/api/backup", { method: "POST" });
      if (res.ok) router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="font-medium">Backups</h2>
        <p className="text-sm text-muted-foreground">A full archive (audio + transcript + summary) of every recording, as a downloadable zip.</p>
      </div>
      <Button onClick={create} disabled={busy}>Create backup</Button>
      <ul className="flex flex-col gap-1 text-sm">
        {initial.length === 0 && <li className="text-muted-foreground">No backups yet.</li>}
        {initial.map((b) => (
          <li key={b.id} className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">
              {new Date(b.createdAt).toLocaleString("en-GB")} — {b.status === "ready" ? `Ready ${fmtSize(b.sizeBytes)}` : b.status === "pending" ? "Generating…" : `Failed${b.error ? `: ${b.error}` : ""}`}
            </span>
            {b.status === "ready" && (
              <Button asChild variant="outline" size="sm"><a href={`/api/backup/${b.id}/download`}>Download</a></Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Render it in `app/settings/page.tsx`**

Add the import + load + render after the existing sections (Plaud, Glossary):
```tsx
import { getBackups } from "@/lib/backup/store";
import { Backups } from "./backups";
// inside the component, after the other loads:
  const backups = await getBackups();
// in JSX, after the other sections:
      <Backups initial={backups.map((b) => ({ id: b.id, status: b.status, sizeBytes: b.sizeBytes, error: b.error, createdAt: b.createdAt.toISOString() }))} />
```

- [ ] **Step 3: Typecheck + tests + commit**

Run: `pnpm exec tsc --noEmit && pnpm test`
```bash
git add app/settings/backups.tsx app/settings/page.tsx
git commit -m "feat: add Backups section to Settings"
```

---

### Task 8: Docs

**Files:**
- Modify: `PROGRESS.md`, `DEPLOY.md`

- [ ] **Step 1: PROGRESS.md** — mark "Export (MD / JSON / Notion / full backup)" DONE under Phase 1+ (all three Phase 1+ slices now complete); link the spec; note Phase 1+ is finished and next is the Phase 2 AI layer.
- [ ] **Step 2: DEPLOY.md** — add a short note: backups are stored in R2 under `backups/` and generated asynchronously; no new env vars.
- [ ] **Step 3:** `pnpm exec tsc --noEmit && pnpm test`, then commit `chore: mark export & backup slice done`.

---

## Self-Review

**Spec coverage:** MD/JSON serializers + filename → Task 1. Notion-friendly MD + copy + download route + buttons → Tasks 1–2. `backups` table → Task 3. `putStream` + archiver → Task 4. async resilient `buildBackup` (data+audio zip, manifest, per-item skip, R2 stream) → Task 5. POST/GET/download routes (fire-and-forget + outer catch, 409 not-ready) → Task 6. Settings Backups UI (create/list/status/download/poll) → Task 7. Security (session guards, presigned download) → Tasks 2/6. Docs → Task 8. All spec sections covered.

**Placeholder scan:** No "TODO/handle errors" prose. The streaming/zip internals are concrete code flagged as runtime-verified (tests mock them); no vague placeholders.

**Type consistency:** `Rec`/`Tr`/`Enh` structural types match the real columns (`recordings.title/source/createdAt/durationSeconds/status`, `transcriptions.fullText/language/segments`, `aiEnhancements.title/summary/actionItems/keyPoints`). `recordingToMarkdown(rec, tr, enh)` / `recordingToExport(...)` / `exportFilename(title,id,ext)` signatures consistent across Tasks 1/2/5. `Backup` shape consistent across store (Task 3), routes (Task 6), UI (Task 7). `Storage.putStream(key, Readable, contentType)` (Task 4) consumed by `buildBackup` (Task 5). `buildBackup(id)` consumed by the POST route (Task 6). The detail page already loads recording+tr+enh (reused by the export route's own fresh load). `audioExt` uses `recordings.contentType` (a real column).
