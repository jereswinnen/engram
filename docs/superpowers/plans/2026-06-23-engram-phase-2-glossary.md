# Engram Phase 2 — Glossary / Vocabulary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user-managed glossary (term + aliases) that biases Scribe transcription toward correct spellings, deterministically corrects known mis-hearings, and steers summaries — managed in Settings, a no-op when empty.

**Architecture:** New `glossary` table + a `lib/glossary/` module (Drizzle CRUD store + a pure `apply` helper for keyterms/correction/prompt). The pipeline loads the glossary in `runTranscription` (pass Scribe `keyterms`, then alias-correct the result) and `runEnhancement` (inject a prompt block). CRUD via session-guarded API routes + a Settings section.

**Tech Stack:** Next.js 16 + TS, pnpm, Drizzle + postgres.js, Vitest. Reuses `lib/transcription/scribe.ts`, `lib/ai/enhance.ts`, `lib/pipeline.ts`, `auth`, `requireSession`.

**Spec:** `docs/superpowers/specs/2026-06-23-engram-phase-2-glossary-design.md`

## Global Constraints

- **pnpm only.** Conventional commits. Clean/modular code.
- **Next.js 16:** route-handler + async-`params`/`searchParams` conventions; `auth.api.getSession({ headers: request.headers })` gate. Read `node_modules/next/dist/docs/` before Next-specific code.
- **Root-level layout** (no `src/`); `@/* → ./*`.
- **TDD** where specified. The pure logic in `lib/glossary/apply.ts` is the primary test target.
- **Empty glossary = total no-op:** no `keyterms` sent (no +20% Scribe cost), no correction, no prompt block.
- **Scribe `keyterms` limits** (verbatim): array of strings, ≤50 chars each, ≤5 words each (after whitespace-normalization), no `<>{}[]\` characters, ≤1000 terms; using it adds ~20% to transcription cost.
- **Lossless:** store the original (pre-correction) Scribe text in `transcriptions.rawText`; the audio in R2 allows a full re-transcribe if ever needed.
- **English UI.** Summaries stay Dutch (don't touch the Dutch enhance prompt's language).
- Applies to **new recordings going forward**; no re-processing of existing recordings.

## File Structure

```
db/schema.ts                 # + glossary table; + transcriptions.rawText column
lib/glossary/
  apply.ts                   # pure: toKeyterms, applyAliasCorrections, glossaryPromptBlock, GlossaryEntry
  apply.test.ts
  store.ts                   # Drizzle CRUD: getGlossary/addEntry/updateEntry/deleteEntry
  store.test.ts
lib/transcription/scribe.ts  # + keyterms option
lib/transcription/scribe.test.ts  # + keyterms-in-request test
lib/ai/enhance.ts            # + optional glossaryBlock
lib/pipeline.ts              # wire glossary into runTranscription/runEnhancement
lib/pipeline.test.ts         # + glossary.findMany mock (returns [])
app/api/glossary/route.ts        # GET list, POST create
app/api/glossary/[id]/route.ts   # PATCH update, DELETE
app/api/glossary/glossary-api.test.ts  # validation + auth gate
app/settings/page.tsx        # load glossary + render <GlossarySettings>
app/settings/glossary-settings.tsx  # client CRUD UI
drizzle/                     # new migration
DEPLOY.md / PROGRESS.md      # docs
```

---

### Task 1: `glossary` table + `transcriptions.rawText` + store

**Files:**
- Modify: `db/schema.ts`
- Create: `lib/glossary/store.ts`, `lib/glossary/store.test.ts`, migration in `drizzle/`

**Interfaces:**
- Produces: `glossary` table (`id` uuid pk, `term` text not null, `aliases` jsonb `string[]` default `[]`, `createdAt` timestamp). `transcriptions.rawText` (text, nullable). `GlossaryEntry = { id: string; term: string; aliases: string[]; createdAt: Date }`. Store fns: `getGlossary(): Promise<GlossaryEntry[]>`, `addEntry(input: { term: string; aliases?: string[] }): Promise<GlossaryEntry>`, `updateEntry(id: string, input: { term?: string; aliases?: string[] }): Promise<void>`, `deleteEntry(id: string): Promise<void>`.

- [ ] **Step 1: Add the schema**

In `db/schema.ts` add the table (imports `uuid`/`text`/`jsonb`/`timestamp` already present), and add `rawText` to `transcriptions`:
```ts
export const glossary = pgTable("glossary", {
  id: uuid("id").primaryKey().defaultRandom(),
  term: text("term").notNull(),
  aliases: jsonb("aliases").notNull().$type<string[]>().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```
In the existing `transcriptions` table definition, add one column:
```ts
  rawText: text("raw_text"),
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`
Expected: a new `drizzle/000N_*.sql` creating `glossary` and adding `transcriptions.raw_text`. Do NOT run `db:migrate` (no DB here; applied on deploy).

- [ ] **Step 3: Write the failing store test**

`lib/glossary/store.test.ts` (in-memory mocked db):
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const rows: any[] = [];
vi.mock("@/db", () => ({
  db: {
    query: { glossary: { findMany: async () => rows.slice() } },
    insert: () => ({ values: (v: any) => ({ returning: async () => { const row = { id: `g${rows.length}`, createdAt: new Date(), aliases: [], ...v }; rows.push(row); return [row]; } }) }),
    update: () => ({ set: (v: any) => ({ where: async () => { Object.assign(rows[0], v); } }) }),
    delete: () => ({ where: async () => { rows.length = 0; } }),
  },
}));

beforeEach(() => { rows.length = 0; });

describe("glossary store", () => {
  it("adds and lists entries", async () => {
    const { addEntry, getGlossary } = await import("./store");
    await addEntry({ term: "Riffado", aliases: ["Rifado"] });
    const all = await getGlossary();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ term: "Riffado", aliases: ["Rifado"] });
  });
  it("defaults aliases to [] when omitted", async () => {
    const { addEntry } = await import("./store");
    const e = await addEntry({ term: "Engram" });
    expect(e.aliases).toEqual([]);
  });
});
```

- [ ] **Step 4: Run test → fails**

Run: `pnpm test lib/glossary/store.test.ts`
Expected: FAIL (`Cannot find module './store'`).

- [ ] **Step 5: Implement `lib/glossary/store.ts`**

```ts
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { glossary } from "@/db/schema";

export interface GlossaryEntry {
  id: string;
  term: string;
  aliases: string[];
  createdAt: Date;
}

export async function getGlossary(): Promise<GlossaryEntry[]> {
  const rows = await db.query.glossary.findMany();
  return rows.map((r: any) => ({ id: r.id, term: r.term, aliases: r.aliases ?? [], createdAt: r.createdAt }));
}

export async function addEntry(input: { term: string; aliases?: string[] }): Promise<GlossaryEntry> {
  const [row] = await db
    .insert(glossary)
    .values({ term: input.term.trim(), aliases: input.aliases ?? [] })
    .returning();
  return { id: row.id, term: row.term, aliases: row.aliases ?? [], createdAt: row.createdAt };
}

export async function updateEntry(id: string, input: { term?: string; aliases?: string[] }): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (input.term !== undefined) patch.term = input.term.trim();
  if (input.aliases !== undefined) patch.aliases = input.aliases;
  if (Object.keys(patch).length === 0) return;
  await db.update(glossary).set(patch).where(eq(glossary.id, id));
}

export async function deleteEntry(id: string): Promise<void> {
  await db.delete(glossary).where(eq(glossary.id, id));
}
```

- [ ] **Step 6: Run test → passes; typecheck; commit**

Run: `pnpm test lib/glossary/store.test.ts && pnpm exec tsc --noEmit`
```bash
git add db/schema.ts drizzle/ lib/glossary/store.ts lib/glossary/store.test.ts
git commit -m "feat: add glossary table, transcriptions.rawText, and glossary store"
```

---

### Task 2: Pure glossary apply helpers

**Files:**
- Create: `lib/glossary/apply.ts`, `lib/glossary/apply.test.ts`

**Interfaces:**
- Consumes: `GlossaryEntry` (re-declared minimally here to keep `apply.ts` pure/IO-free — see note).
- Produces: `toKeyterms(entries): string[]`, `applyAliasCorrections(text, entries): string`, `glossaryPromptBlock(entries): string`.

Note: to keep `apply.ts` dependency-free (no `@/db`), define a local structural type `type GlossaryLike = { term: string; aliases: string[] }` and have all three functions accept `GlossaryLike[]`. `GlossaryEntry` from the store is assignable to it.

- [ ] **Step 1: Write the failing test**

`lib/glossary/apply.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { toKeyterms, applyAliasCorrections, glossaryPromptBlock } from "./apply";

const g = (term: string, aliases: string[] = []) => ({ term, aliases });

describe("toKeyterms", () => {
  it("returns sanitized, deduped canonical terms", () => {
    expect(toKeyterms([g("Riffado"), g("riffado"), g("Engram")])).toEqual(["Riffado", "Engram"]);
  });
  it("drops terms over 50 chars or over 5 words, and strips forbidden chars", () => {
    expect(toKeyterms([g("a".repeat(51))])).toEqual([]);
    expect(toKeyterms([g("one two three four five six")])).toEqual([]);
    expect(toKeyterms([g("Acme <Corp>")])).toEqual(["Acme Corp"]);
  });
  it("caps at 1000", () => {
    const many = Array.from({ length: 1100 }, (_, i) => g(`term${i}`));
    expect(toKeyterms(many)).toHaveLength(1000);
  });
});

describe("applyAliasCorrections", () => {
  it("replaces aliases with the canonical term, case-insensitive, canonical casing", () => {
    expect(applyAliasCorrections("rifado and Rifado rock", [g("Riffado", ["Rifado"])])).toBe("Riffado and Riffado rock");
  });
  it("respects word boundaries (no substring corruption)", () => {
    expect(applyAliasCorrections("let's meet again about AI", [g("AI Corp", ["AI"])])).toBe("let's meet again about AI Corp");
  });
  it("applies longer aliases before shorter to avoid partial overlap", () => {
    expect(applyAliasCorrections("Rifado", [g("Riffado", ["Rif", "Rifado"])])).toBe("Riffado");
  });
  it("is a no-op for an empty glossary", () => {
    expect(applyAliasCorrections("unchanged", [])).toBe("unchanged");
  });
});

describe("glossaryPromptBlock", () => {
  it("returns empty string for empty glossary", () => {
    expect(glossaryPromptBlock([])).toBe("");
  });
  it("lists the canonical terms", () => {
    expect(glossaryPromptBlock([g("Riffado"), g("Engram")])).toContain("Riffado");
  });
});
```

- [ ] **Step 2: Run test → fails**

Run: `pnpm test lib/glossary/apply.test.ts`
Expected: FAIL (`Cannot find module './apply'`).

- [ ] **Step 3: Implement `lib/glossary/apply.ts`**

```ts
export type GlossaryLike = { term: string; aliases: string[] };

const FORBIDDEN = /[<>{}[\]\\]/g;

function normalizeTerm(raw: string): string {
  return (raw ?? "").replace(FORBIDDEN, "").replace(/\s+/g, " ").trim();
}

export function toKeyterms(entries: GlossaryLike[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const term = normalizeTerm(e.term);
    if (!term || term.length > 50 || term.split(" ").length > 5) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= 1000) break;
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function applyAliasCorrections(text: string, entries: GlossaryLike[]): string {
  if (!text) return text;
  const pairs: { alias: string; canonical: string }[] = [];
  for (const e of entries) {
    const canonical = (e.term ?? "").trim();
    if (!canonical) continue;
    for (const a of e.aliases ?? []) {
      const alias = (a ?? "").trim();
      if (alias && alias.toLowerCase() !== canonical.toLowerCase()) pairs.push({ alias, canonical });
    }
  }
  // longer aliases first so a longer match isn't pre-empted by a shorter overlapping one
  pairs.sort((a, b) => b.alias.length - a.alias.length);
  let result = text;
  for (const { alias, canonical } of pairs) {
    const re = new RegExp(`\\b${escapeRegExp(alias)}\\b`, "gi");
    result = result.replace(re, canonical);
  }
  return result;
}

export function glossaryPromptBlock(entries: GlossaryLike[]): string {
  const terms = entries.map((e) => (e.term ?? "").trim()).filter(Boolean);
  if (terms.length === 0) return "";
  return `Gebruik de correcte spelling voor deze termen/namen: ${terms.join(", ")}.`;
}
```

- [ ] **Step 4: Run test → passes; commit**

Run: `pnpm test lib/glossary/apply.test.ts && pnpm exec tsc --noEmit`
```bash
git add lib/glossary/apply.ts lib/glossary/apply.test.ts
git commit -m "feat: add pure glossary apply helpers (keyterms, alias correction, prompt block)"
```

---

### Task 3: Scribe `keyterms` option

**Files:**
- Modify: `lib/transcription/scribe.ts`, `lib/transcription/scribe.test.ts`

**Interfaces:**
- Produces: `ScribeOptions.keyterms?: string[]`. When non-empty, sent in the request; absent otherwise.

- [ ] **Step 1: Read the ElevenLabs keyterms encoding**

Confirm how `keyterms` (an array) is sent on the multipart `speech-to-text` endpoint — JSON-encoded string vs. repeated fields. Default to a **JSON string** (`form.append("keyterms", JSON.stringify(keyterms))`) unless the docs/a live call show otherwise; note which you used. Tests assert presence/shape, not the live API.

- [ ] **Step 2: Write the failing test**

Add to `lib/transcription/scribe.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { transcribeWithScribe } from "./scribe";

afterEach(() => vi.restoreAllMocks());

function okResponse() {
  return new Response(JSON.stringify({ text: "hoi", language_code: "nld", words: [] }), { status: 200 });
}

describe("transcribeWithScribe keyterms", () => {
  it("includes keyterms in the request when provided", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(okResponse());
    await transcribeWithScribe({ cloudStorageUrl: "https://x" }, { apiKey: "k", keyterms: ["Riffado", "Engram"] });
    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData;
    expect(body.get("keyterms")).toBe(JSON.stringify(["Riffado", "Engram"]));
  });
  it("omits keyterms when none provided", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(okResponse());
    await transcribeWithScribe({ cloudStorageUrl: "https://x" }, { apiKey: "k" });
    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData;
    expect(body.get("keyterms")).toBeNull();
  });
});
```

- [ ] **Step 3: Run test → fails**

Run: `pnpm test lib/transcription/scribe.test.ts`
Expected: FAIL (keyterms not in form / option not supported).

- [ ] **Step 4: Implement**

In `lib/transcription/scribe.ts`, add to `ScribeOptions`:
```ts
  /** Bias transcription toward these terms (Scribe `keyterms`). Sent only when non-empty. */
  keyterms?: string[];
```
In `transcribeWithScribe`, after the other `form.append(...)` calls and before the input branch:
```ts
  if (options.keyterms && options.keyterms.length > 0) {
    form.append("keyterms", JSON.stringify(options.keyterms));
  }
```

- [ ] **Step 5: Run test → passes; commit**

Run: `pnpm test lib/transcription/scribe.test.ts && pnpm exec tsc --noEmit`
```bash
git add lib/transcription/scribe.ts lib/transcription/scribe.test.ts
git commit -m "feat: add keyterms option to Scribe adapter"
```

---

### Task 4: Wire the glossary into the pipeline

**Files:**
- Modify: `lib/ai/enhance.ts`, `lib/pipeline.ts`, `lib/pipeline.test.ts`

**Interfaces:**
- Consumes: `getGlossary` (store), `toKeyterms`/`applyAliasCorrections`/`glossaryPromptBlock` (apply).
- Produces: `enhanceTranscript(transcript, opts?)` gains `opts.glossaryBlock?: string`. `runTranscription` stores `rawText` (original) + corrected `fullText`/`segments`.

- [ ] **Step 1: Add `glossaryBlock` to `enhance.ts`**

```ts
export async function enhanceTranscript(
  transcript: string,
  opts: { model?: string; glossaryBlock?: string } = {},
): Promise<Enhancement> {
  const openai = createOpenAI({ apiKey: config.openAiApiKey() });
  const model = opts.model ?? config.llmModel();
  const system =
    "Je bent een assistent die vergaderingen samenvat. Antwoord altijd in het Nederlands. " +
    "De transcriptie is gediarizeerd (sprekers gelabeld); attribueer actiepunten aan de juiste spreker waar mogelijk." +
    (opts.glossaryBlock ? `\n\n${opts.glossaryBlock}` : "");
  const { object } = await generateObject({
    model: openai(model),
    schema: enhancementSchema,
    system,
    prompt: `Transcriptie:\n\n${transcript}`,
  });
  return object;
}
```

- [ ] **Step 2: Update the pipeline-test db mock first (so existing tests still pass)**

In `lib/pipeline.test.ts`, extend the `@/db` mock's `query` with a glossary entry returning `[]`:
```ts
    query: {
      recordings: { findFirst: async () => ({ id: "r1", storageKey: "audio/r1.mp3" }) },
      transcriptions: { findFirst: async () => ({ recordingId: "r1", fullText: "hoi" }) },
      glossary: { findMany: async () => [] },
    },
```

- [ ] **Step 3: Wire `runTranscription` + `runEnhancement` in `lib/pipeline.ts`**

Add imports:
```ts
import { getGlossary } from "@/lib/glossary/store";
import { toKeyterms, applyAliasCorrections, glossaryPromptBlock } from "@/lib/glossary/apply";
```
In `runTranscription`, replace the Scribe call + insert with:
```ts
    const glossary = await getGlossary();
    const url = await getStorage().presignedGetUrl(rec.storageKey, 3600);
    const result = await transcribeWithScribe({ cloudStorageUrl: url }, { keyterms: toKeyterms(glossary) });
    const correctedText = applyAliasCorrections(result.text, glossary);
    const correctedSegments = result.segments.map((s) => ({ ...s, text: applyAliasCorrections(s.text, glossary) }));
    await db.insert(transcriptions).values({
      recordingId: id,
      fullText: correctedText,
      rawText: result.text,
      language: result.language ?? null,
      segments: correctedSegments,
    });
```
In `runEnhancement`, pass the prompt block:
```ts
    const glossary = await getGlossary();
    const e = await enhanceTranscript(t.fullText, { glossaryBlock: glossaryPromptBlock(glossary) });
```

- [ ] **Step 4: Run pipeline tests + full suite + typecheck**

Run: `pnpm test lib/pipeline.test.ts && pnpm exec tsc --noEmit && pnpm test`
Expected: green (empty glossary → keyterms `[]`, correction no-op, prompt block `""` → behavior unchanged).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/enhance.ts lib/pipeline.ts lib/pipeline.test.ts
git commit -m "feat: apply glossary in transcription (keyterms + correction) and enhancement"
```

---

### Task 5: Glossary API routes

**Files:**
- Create: `app/api/glossary/route.ts`, `app/api/glossary/[id]/route.ts`, `app/api/glossary/glossary-api.test.ts`

**Interfaces:**
- `GET /api/glossary` (session) → entries; `POST /api/glossary` (session, body `{ term, aliases? }`, 400 if term empty) → `{ id }`; `PATCH /api/glossary/[id]` (session, body `{ term?, aliases? }`) → `{ ok: true }`; `DELETE /api/glossary/[id]` (session) → `{ ok: true }`. Exports a testable `parseEntryInput(body): { term: string; aliases: string[] } | null` from `route.ts` (null = invalid).

- [ ] **Step 1: Write the failing validation test**

`app/api/glossary/glossary-api.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseEntryInput } from "./route";

describe("parseEntryInput", () => {
  it("accepts a term + aliases", () => {
    expect(parseEntryInput({ term: " Riffado ", aliases: ["Rifado", " "] })).toEqual({ term: "Riffado", aliases: ["Rifado"] });
  });
  it("defaults aliases to []", () => {
    expect(parseEntryInput({ term: "Engram" })).toEqual({ term: "Engram", aliases: [] });
  });
  it("rejects empty/missing term", () => {
    expect(parseEntryInput({ aliases: ["x"] })).toBeNull();
    expect(parseEntryInput({ term: "   " })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test → fails**

Run: `pnpm test app/api/glossary/glossary-api.test.ts`
Expected: FAIL (`Cannot find module './route'`).

- [ ] **Step 3: Implement `app/api/glossary/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getGlossary, addEntry } from "@/lib/glossary/store";

export function parseEntryInput(body: any): { term: string; aliases: string[] } | null {
  const term = typeof body?.term === "string" ? body.term.trim() : "";
  if (!term) return null;
  const aliases = Array.isArray(body?.aliases)
    ? body.aliases.map((a: unknown) => (typeof a === "string" ? a.trim() : "")).filter(Boolean)
    : [];
  return { term, aliases };
}

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getGlossary());
}

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  const parsed = parseEntryInput(body);
  if (!parsed) return NextResponse.json({ error: "term required" }, { status: 400 });
  const entry = await addEntry(parsed);
  return NextResponse.json({ id: entry.id }, { status: 201 });
}
```

- [ ] **Step 4: Implement `app/api/glossary/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { updateEntry, deleteEntry } from "@/lib/glossary/store";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  const patch: { term?: string; aliases?: string[] } = {};
  if (typeof body?.term === "string") {
    const t = body.term.trim();
    if (!t) return NextResponse.json({ error: "term cannot be empty" }, { status: 400 });
    patch.term = t;
  }
  if (Array.isArray(body?.aliases)) {
    patch.aliases = body.aliases.map((a: unknown) => (typeof a === "string" ? a.trim() : "")).filter(Boolean);
  }
  await updateEntry(id, patch);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await deleteEntry(id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Run test → passes; full suite + typecheck; commit**

Run: `pnpm test app/api/glossary/glossary-api.test.ts && pnpm exec tsc --noEmit && pnpm test`
```bash
git add app/api/glossary
git commit -m "feat: add glossary CRUD API routes"
```

---

### Task 6: Settings glossary UI

**Files:**
- Modify: `app/settings/page.tsx`
- Create: `app/settings/glossary-settings.tsx`

**Interfaces:**
- Consumes: `getGlossary` (server, initial data), the `/api/glossary` routes.

- [ ] **Step 1: Client component `app/settings/glossary-settings.tsx`**

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Entry = { id: string; term: string; aliases: string[] };

export function GlossarySettings({ entries }: { entries: Entry[] }) {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [aliases, setAliases] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/glossary", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term, aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean) }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not add term");
      setTerm(""); setAliases(""); router.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/glossary/${id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="font-medium">Glossary</h2>
        <p className="text-sm text-muted-foreground">Terms and names to spell correctly in transcripts and summaries. Aliases (comma-separated) are common mishearings to auto-correct.</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input placeholder="Term (e.g. Riffado)" value={term} onChange={(e) => setTerm(e.target.value)} />
        <Input placeholder="Aliases: Rifado, riff a do" value={aliases} onChange={(e) => setAliases(e.target.value)} />
        <Button onClick={add} disabled={busy || term.trim().length === 0}>Add</Button>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <ul className="space-y-1">
        {entries.length === 0 && <li className="text-sm text-muted-foreground">No terms yet.</li>}
        {entries.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-2 text-sm">
            <span><strong>{e.term}</strong>{e.aliases.length > 0 && <span className="text-muted-foreground"> — {e.aliases.join(", ")}</span>}</span>
            <Button variant="outline" size="sm" onClick={() => remove(e.id)} disabled={busy}>Delete</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```
(If shadcn `Button` lacks a `size` prop, drop `size="sm"`. Confirm against `components/ui/button.tsx`.)

- [ ] **Step 2: Render it in `app/settings/page.tsx`**

Add the import + load + render (keep existing Plaud section):
```tsx
import { getGlossary } from "@/lib/glossary/store";
import { GlossarySettings } from "./glossary-settings";
// inside the component, after `const sync = ...`:
  const glossary = await getGlossary();
// in the JSX, after <PlaudSettings .../>:
      <GlossarySettings entries={glossary.map((g) => ({ id: g.id, term: g.term, aliases: g.aliases }))} />
```

- [ ] **Step 3: Typecheck + tests + manual note**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: clean + green. (UI verified by typecheck + the deferred manual run; no new automated UI tests.)

- [ ] **Step 4: Commit**

```bash
git add app/settings
git commit -m "feat: add glossary management UI to Settings"
```

---

### Task 7: Docs

**Files:**
- Modify: `DEPLOY.md`, `PROGRESS.md`

- [ ] **Step 1: DEPLOY.md** — add a short "Glossary" note: managed in Settings; using glossary terms enables Scribe `keyterms` which adds ~20% to transcription cost (only when the glossary is non-empty); aliases are auto-corrected; applies to new recordings going forward.

- [ ] **Step 2: PROGRESS.md** — mark Phase 2 started and the glossary slice done; link this plan + the spec `docs/superpowers/specs/2026-06-23-engram-phase-2-glossary-design.md`; note remaining Phase 2 slices (speaker naming, multi-view summaries + templates, RAG) as pending.

- [ ] **Step 3: Typecheck + suite + commit**

Run: `pnpm exec tsc --noEmit && pnpm test`
```bash
git add DEPLOY.md PROGRESS.md
git commit -m "chore: document glossary feature and Phase 2 progress"
```

---

## Self-Review

**Spec coverage:** glossary table + entry shape (term+aliases) → Task 1. Scribe keyterms (sanitized to limits) → Tasks 2 (`toKeyterms`) + 3 (option) + 4 (wired). Deterministic alias correction → Tasks 2 (`applyAliasCorrections`) + 4. Summary-prompt injection → Tasks 2 (`glossaryPromptBlock`) + 4 (enhance). Empty-glossary no-op → covered by `toKeyterms([])=[]`, correction no-op, `""` block (Tasks 2/4, pipeline test). Lossless via `rawText` → Tasks 1+4. Management UI → Tasks 5+6. Cost note + docs → Task 7. New-recordings-only (no reprocess) → not built (correct). All spec sections covered.

**Placeholder scan:** No "TODO/handle errors" instructions. The one verify-point (keyterms multipart encoding) has a concrete default (JSON string) + a test that pins the chosen shape — not a vague placeholder.

**Type consistency:** `GlossaryEntry` (store, Task 1) is structurally assignable to `GlossaryLike` (apply, Task 2). `getGlossary`/`addEntry`/`updateEntry`/`deleteEntry` names consistent across Tasks 1/4/5. `toKeyterms`/`applyAliasCorrections`/`glossaryPromptBlock` consistent across Tasks 2/4. `ScribeOptions.keyterms` (Task 3) consumed in Task 4. `enhanceTranscript(transcript, { model?, glossaryBlock? })` consistent (Task 4). `parseEntryInput` (Task 5) returns `{term, aliases}`. Settings `Entry` type matches the store's `{id,term,aliases}` projection (Tasks 5/6). Pipeline insert uses real columns incl. the new `rawText` (Task 1).
