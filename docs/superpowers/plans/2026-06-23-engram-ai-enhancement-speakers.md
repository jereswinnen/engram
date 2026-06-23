# Engram Rich AI Enhancement + Speaker Naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a Plaud-grade structured AI enhancement (overview, key points, decisions, owner+due action items, timestamped chapters, open questions; always English) and let the user name diarized speakers via a reusable directory, with first-class regeneration.

**Architecture:** Ship the rich enhancement first (works with anonymous `Speaker N` owners), then layer non-destructive speaker naming (a `speakers` directory + per-recording `recordingSpeakers` label→speaker map, substituted at read time) and a manual Regenerate. Chapters tie into the existing waveform via `setTime`.

**Tech Stack:** Next.js 16 + TS, pnpm, Drizzle + postgres.js, Vercel AI SDK (`generateObject` + Zod), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-23-engram-ai-enhancement-speakers-design.md`

## Global Constraints

- **pnpm only.** Conventional commits. Clean/modular code. English UI.
- **Summaries always in English** (the system prompt is English).
- **Model is configurable** via `config.llmModel()` — do NOT hardcode a model.
- **Naming is non-destructive:** never rewrite `transcriptions.segments`; map labels→names at read time.
- **Next.js 16:** server components default; async `params`/`searchParams`; `requireSession()` for pages, `auth.api.getSession({ headers })` for routes. Read `node_modules/next/dist/docs/` before Next-specific changes.
- **Root-level layout** (no `src/`); `@/* → ./*`.
- **TDD** for pure units (schema, speaker-names helpers, speakers store) + the exports. Pipeline/UI/API verified by `pnpm exec tsc --noEmit` + manual run.

## File Structure

```
lib/ai/schema.ts             # rich enhancementSchema + Enhancement type [pure]
lib/ai/enhance.ts            # English prompt; generateObject(rich schema)
lib/ai/*.test.ts
lib/transcript/speaker-names.ts   # nameForLabel + buildNamedTranscript [pure]
lib/transcript/speaker-names.test.ts
lib/speakers/store.ts        # directory + per-recording mapping CRUD
lib/speakers/store.test.ts
db/schema.ts                 # aiEnhancements changes + speakers + recordingSpeakers
drizzle/                     # 2 migrations (enhancement reshape; speaker tables)
lib/pipeline.ts              # runEnhancement → rich + named transcript
app/recordings/[id]/page.tsx # render rich sections; pass chapters/speaker data to player
app/recordings/[id]/transcript-player.tsx  # chapters→seek; inline speaker rename
app/recordings/[id]/regenerate-button.tsx  # client: Regenerate + post-rename hint
app/api/recordings/[id]/speakers/route.ts    # PUT label→name
app/api/recordings/[id]/regenerate/route.ts  # POST re-run enhancement
lib/export/markdown.ts , json.ts  # richer fields + resolved names
PROGRESS.md
```

---

### Task 1: Rich enhancement schema + English prompt

**Files:**
- Modify: `lib/ai/schema.ts`, `lib/ai/enhance.ts`
- Create/Modify: `lib/ai/schema.test.ts`, `lib/ai/enhance.test.ts`

**Interfaces:**
- Produces: `enhancementSchema` (Zod) and `Enhancement` = `{ title: string; overview: string; keyPoints: string[]; decisions: string[]; actionItems: { text: string; owner?: string; due?: string }[]; chapters: { title: string; gist: string; startSeconds?: number }[]; openQuestions: string[] }`. `enhanceTranscript(transcript: string, opts?: { model?: string; glossaryBlock?: string }): Promise<Enhancement>` (transcript is the named+timestamped string the caller builds).

- [ ] **Step 1: Write the failing tests**

`lib/ai/schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { enhancementSchema } from "./schema";

const full = {
  title: "Sync", overview: "We discussed X.",
  keyPoints: ["a"], decisions: ["ship it"],
  actionItems: [{ text: "send quote", owner: "Bjorn", due: "Friday" }, { text: "review" }],
  chapters: [{ title: "Intro", gist: "hellos", startSeconds: 0 }, { title: "Budget", gist: "money" }],
  openQuestions: ["when to launch?"],
};

describe("enhancementSchema", () => {
  it("accepts a full object (optional owner/due/startSeconds may be absent)", () => {
    expect(enhancementSchema.safeParse(full).success).toBe(true);
  });
  it("rejects an action item without text", () => {
    expect(enhancementSchema.safeParse({ ...full, actionItems: [{ owner: "x" }] }).success).toBe(false);
  });
});
```
`lib/ai/enhance.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const captured: any = {};
vi.mock("ai", () => ({
  generateObject: vi.fn(async (args: any) => {
    captured.system = args.system; captured.prompt = args.prompt; captured.schema = args.schema;
    return { object: { title: "T", overview: "O", keyPoints: [], decisions: [], actionItems: [], chapters: [], openQuestions: [] } };
  }),
}));
vi.mock("@ai-sdk/openai", () => ({ createOpenAI: () => () => ({}) }));
vi.mock("@/lib/config", () => ({ config: { openAiApiKey: () => "k", llmModel: () => "test-model" } }));
beforeEach(() => { for (const k of Object.keys(captured)) delete captured[k]; });

describe("enhanceTranscript", () => {
  it("uses an English system prompt and includes the glossary block", async () => {
    const { enhanceTranscript } = await import("./enhance");
    await enhanceTranscript("[0:05] Speaker 1: hi", { glossaryBlock: "GLOSSARY-XYZ" });
    expect(captured.system).toMatch(/English/i);
    expect(captured.system).not.toMatch(/Nederlands/);
    expect(captured.system).toContain("GLOSSARY-XYZ");
    expect(captured.prompt).toContain("[0:05] Speaker 1: hi");
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `pnpm test lib/ai/`  → FAIL (schema shape / English assertions).

- [ ] **Step 3: Implement**

`lib/ai/schema.ts`:
```ts
import { z } from "zod";

export const enhancementSchema = z.object({
  title: z.string().describe("Short, descriptive title in English"),
  overview: z.string().describe("Concise overview / TL;DR in English"),
  keyPoints: z.array(z.string()).describe("Key points discussed"),
  decisions: z.array(z.string()).describe("Explicit decisions made (empty if none)"),
  actionItems: z
    .array(
      z.object({
        text: z.string().describe("The action to take"),
        owner: z.string().optional().describe("The responsible speaker's name, if clear from the transcript"),
        due: z.string().optional().describe("Due date/timeframe exactly as stated, if any"),
      }),
    )
    .describe("Concrete action items"),
  chapters: z
    .array(
      z.object({
        title: z.string(),
        gist: z.string().describe("One-line summary of the section"),
        startSeconds: z.number().optional().describe("Approx start time in seconds, from the [mm:ss] timestamps"),
      }),
    )
    .describe("Topic outline / chapters in chronological order"),
  openQuestions: z.array(z.string()).describe("Unresolved questions or follow-ups (empty if none)"),
});

export type Enhancement = z.infer<typeof enhancementSchema>;
```
`lib/ai/enhance.ts` (replace the system prompt + keep structure):
```ts
import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { config } from "@/lib/config";
import { enhancementSchema, type Enhancement } from "./schema";

export async function enhanceTranscript(
  transcript: string,
  opts: { model?: string; glossaryBlock?: string } = {},
): Promise<Enhancement> {
  const openai = createOpenAI({ apiKey: config.openAiApiKey() });
  const model = opts.model ?? config.llmModel();
  const system =
    "You are an assistant that produces high-quality meeting notes. Always answer in English. " +
    "The transcript is diarized (speakers labelled, names where known) with [mm:ss] timestamps. " +
    "Attribute each action item to the responsible speaker by name when clear, capture explicit decisions, " +
    "list the topics as chapters in order with an approximate startSeconds taken from the timestamps, " +
    "and note any open questions." +
    (opts.glossaryBlock ? `\n\n${opts.glossaryBlock}` : "");
  const { object } = await generateObject({
    model: openai(model),
    schema: enhancementSchema,
    system,
    prompt: `Transcript:\n\n${transcript}`,
  });
  return object;
}
```

- [ ] **Step 4: Run → pass; typecheck; commit**

Run: `pnpm test lib/ai/ && pnpm exec tsc --noEmit`
(tsc will now flag `lib/pipeline.ts` + the detail page still using `summary`/string action items — that's expected; those are fixed in Tasks 3–4. If tsc fails ONLY there, proceed; otherwise fix. To keep this task green, it's acceptable that the type errors in pipeline/page are addressed in their tasks — but if you prefer a clean tsc gate, do a minimal interim cast. Note which you did.)
```bash
git add lib/ai/schema.ts lib/ai/schema.test.ts lib/ai/enhance.ts lib/ai/enhance.test.ts
git commit -m "feat: rich English enhancement schema and prompt"
```

> Note for the controller: Task 1 changes the `Enhancement` type, which **breaks tsc** in `lib/pipeline.ts` and `app/recordings/[id]/page.tsx` until Tasks 3–4 land. Sequence Tasks 1→2→3→4 without a deploy in between; the branch is green again at the end of Task 4. Each task still runs its own unit tests green.

---

### Task 2: speaker-name helpers (pure)

**Files:**
- Create: `lib/transcript/speaker-names.ts`, `lib/transcript/speaker-names.test.ts`

**Interfaces:**
- Produces: `nameForLabel(label: string, map: Record<string, string>): string`; `buildNamedTranscript(segments: { start: number; text: string; speaker?: string | null }[], map: Record<string, string>): string`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { nameForLabel, buildNamedTranscript } from "./speaker-names";

describe("nameForLabel", () => {
  it("maps a known label to its name, falls back to the label otherwise", () => {
    expect(nameForLabel("Speaker 1", { "Speaker 1": "Bjorn" })).toBe("Bjorn");
    expect(nameForLabel("Speaker 2", { "Speaker 1": "Bjorn" })).toBe("Speaker 2");
    expect(nameForLabel("Speaker 1", {})).toBe("Speaker 1");
  });
});
describe("buildNamedTranscript", () => {
  const segs = [{ start: 5, text: "Hoi", speaker: "Speaker 1" }, { start: 65, text: "Ja", speaker: "Speaker 2" }];
  it("renders [mm:ss] Name: text with names substituted", () => {
    const out = buildNamedTranscript(segs, { "Speaker 1": "Bjorn" });
    expect(out).toContain("[0:05] Bjorn: Hoi");
    expect(out).toContain("[1:05] Speaker 2: Ja"); // unmapped → label
  });
  it("uses 'Speaker ?' when a segment has no speaker", () => {
    expect(buildNamedTranscript([{ start: 0, text: "x" }], {})).toContain("Speaker ?: x");
  });
});
```

- [ ] **Step 2: Run → fail** — `pnpm test lib/transcript/speaker-names.test.ts`

- [ ] **Step 3: Implement `lib/transcript/speaker-names.ts`**

```ts
function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function nameForLabel(label: string, map: Record<string, string>): string {
  return map[label] ?? label;
}

export function buildNamedTranscript(
  segments: { start: number; text: string; speaker?: string | null }[],
  map: Record<string, string>,
): string {
  return segments
    .map((s) => `[${mmss(s.start)}] ${nameForLabel(s.speaker ?? "Speaker ?", map)}: ${s.text}`)
    .join("\n");
}
```

- [ ] **Step 4: Run → pass; commit**

```bash
git add lib/transcript/speaker-names.ts lib/transcript/speaker-names.test.ts
git commit -m "feat: add speaker-name resolution and named-transcript helpers"
```

---

### Task 3: `aiEnhancements` migration (reshape)

**Files:**
- Modify: `db/schema.ts`
- Create: migration

**Interfaces:**
- Produces: `aiEnhancements` with `overview` (was `summary`), structured `actionItems`, and new `decisions`/`chapters`/`openQuestions`.

- [ ] **Step 1: Edit `db/schema.ts`** — change the `aiEnhancements` columns:
```ts
export const aiEnhancements = pgTable("ai_enhancements", {
  id: uuid("id").primaryKey().defaultRandom(),
  recordingId: uuid("recording_id").notNull().references(() => recordings.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default("summary"),
  title: text("title"),
  overview: text("overview").notNull(),
  keyPoints: jsonb("key_points").notNull().$type<string[]>(),
  decisions: jsonb("decisions").notNull().$type<string[]>().default([]),
  actionItems: jsonb("action_items").notNull().$type<{ text: string; owner?: string; due?: string }[]>(),
  chapters: jsonb("chapters").notNull().$type<{ title: string; gist: string; startSeconds?: number }[]>().default([]),
  openQuestions: jsonb("open_questions").notNull().$type<{ }[] | string[]>().default([]),
  model: text("model").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```
(Set `openQuestions` `$type<string[]>()` — the `{}[]|` is a typo guard; use `jsonb("open_questions").notNull().$type<string[]>().default([])`.)

- [ ] **Step 2: Generate + make the migration authoritative**

Run: `pnpm db:generate`. drizzle-kit may prompt about `summary`→`overview` (rename vs drop/create). The authoritative migration SQL is:
```sql
ALTER TABLE "ai_enhancements" RENAME COLUMN "summary" TO "overview";
ALTER TABLE "ai_enhancements" ADD COLUMN "decisions" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "ai_enhancements" ADD COLUMN "chapters" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "ai_enhancements" ADD COLUMN "open_questions" jsonb DEFAULT '[]'::jsonb NOT NULL;
DELETE FROM "ai_enhancements";
```
`action_items` stays `jsonb` at the SQL level (only its TS `$type` changed). The `DELETE` clears old rows whose `action_items` are `string[]` (incompatible with the new shape) — those recordings are regenerated. If drizzle-kit emitted drop+add for `summary`/`overview` instead of a rename, that's fine (data is deleted anyway) — but hand-edit the migration to match the SQL above (rename preferred), and **append the `DELETE FROM "ai_enhancements";`** which drizzle won't generate. Do NOT run `db:migrate`.

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm exec tsc --noEmit` (pipeline/page still red until Task 4 — acceptable per Task 1 note; confirm no NEW errors beyond those). `pnpm test`.
```bash
git add db/schema.ts drizzle/
git commit -m "feat: reshape ai_enhancements (overview + decisions/chapters/openQuestions)"
```

---

### Task 4: `runEnhancement` produces the rich enhancement + detail page renders it

**Files:**
- Modify: `lib/pipeline.ts`, `app/recordings/[id]/page.tsx`

**Interfaces:**
- Consumes: `enhanceTranscript` (Task 1), `buildNamedTranscript` (Task 2), the reshaped `aiEnhancements` (Task 3).

- [ ] **Step 1: Update `runEnhancement` in `lib/pipeline.ts`**

Build a timestamped transcript from `t.segments` (anonymous map `{}` for now — real names wired in Task 8) and store all rich fields. Replace the enhancement body:
```ts
import { buildNamedTranscript } from "@/lib/transcript/speaker-names";
// inside runEnhancement, after loading `t`:
    const glossary = await getGlossary().catch(() => []);
    const transcript = buildNamedTranscript(t.segments, {}); // names substituted in Task 8 (regenerate)
    const e = await enhanceTranscript(transcript, { glossaryBlock: glossaryPromptBlock(glossary) });
    await db.insert(aiEnhancements).values({
      recordingId: id,
      title: e.title,
      overview: e.overview,
      keyPoints: e.keyPoints,
      decisions: e.decisions,
      actionItems: e.actionItems,
      chapters: e.chapters,
      openQuestions: e.openQuestions,
      model: config.llmModel(),
    });
```
(`t.segments` is the stored jsonb `{start,end,text,speaker?}[]` — matches `buildNamedTranscript`'s param.)

- [ ] **Step 2: Update the detail page render (`app/recordings/[id]/page.tsx`)**

The summary `<Card>` currently renders `enhancement.summary`, `actionItems` (strings), `keyPoints`. Replace the `CardContent` body (the `isDone && enhancement` branch) with the rich sections (keep the title/processing/else states). Render:
```tsx
{isDone && enhancement ? (
  <div className="flex flex-col gap-4 text-sm">
    <p>{enhancement.overview}</p>

    {enhancement.keyPoints.length > 0 && (
      <Section title="Key points"><ul className="list-disc pl-5">{enhancement.keyPoints.map((p, i) => <li key={i}>{p}</li>)}</ul></Section>
    )}
    {enhancement.decisions.length > 0 && (
      <Section title="Decisions"><ul className="list-disc pl-5">{enhancement.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul></Section>
    )}
    {enhancement.actionItems.length > 0 && (
      <Section title="Action items">
        <ul className="flex flex-col gap-1">
          {enhancement.actionItems.map((a, i) => (
            <li key={i}>
              {a.owner && <span className="font-medium">{a.owner}: </span>}{a.text}
              {a.due && <span className="text-muted-foreground"> (due {a.due})</span>}
            </li>
          ))}
        </ul>
      </Section>
    )}
    {enhancement.openQuestions.length > 0 && (
      <Section title="Open questions"><ul className="list-disc pl-5">{enhancement.openQuestions.map((q, i) => <li key={i}>{q}</li>)}</ul></Section>
    )}
  </div>
) : ( /* keep the existing processing/"not yet" state */ )}
```
Add a tiny local `Section` helper component in the same file: `function Section({ title, children }: { title: string; children: React.ReactNode }) { return (<div className="flex flex-col gap-1"><h3 className="font-medium">{title}</h3>{children}</div>); }`. (Chapters render in Task 5 inside the player.) Update the data load if it selected `summary` by name anywhere.

- [ ] **Step 3: Typecheck + tests + commit**

Run: `pnpm exec tsc --noEmit && pnpm test`  → now CLEAN + green (the Task 1 type breakage is resolved here).
```bash
git add lib/pipeline.ts app/recordings/[id]/page.tsx
git commit -m "feat: generate and render the rich enhancement (anonymous owners)"
```

---

### Task 5: Chapters → waveform seek

**Files:**
- Modify: `app/recordings/[id]/transcript-player.tsx`, `app/recordings/[id]/page.tsx`

**Interfaces:**
- `TranscriptPlayer` gains `chapters?: { title: string; gist: string; startSeconds?: number }[]`.

- [ ] **Step 1: Pass chapters to the player** in `page.tsx`:
```tsx
<TranscriptPlayer audioSrc={…} segments={…} highlightQuery={q} chapters={enhancement?.chapters ?? []} />
```

- [ ] **Step 2: Render a clickable chapters strip in `transcript-player.tsx`**

Add `chapters` to the props type. Above the transcript list (below the waveform), render the chapters when present; clicking seeks (guarded to the audio duration):
```tsx
{chapters && chapters.length > 0 && (
  <div className="flex flex-col gap-1 text-sm">
    <h3 className="font-medium">Chapters</h3>
    {chapters.map((c, i) => {
      const seekable = c.startSeconds != null && c.startSeconds >= 0 && (duration === 0 || c.startSeconds <= duration);
      return (
        <button key={i} type="button" disabled={!seekable}
          onClick={() => { if (seekable) wsRef.current?.setTime(c.startSeconds!); }}
          className="text-left disabled:opacity-60">
          {c.startSeconds != null && <span className="text-muted-foreground text-xs tabular-nums">{formatTime(c.startSeconds)} </span>}
          <span className="font-medium">{c.title}</span> — <span className="text-muted-foreground">{c.gist}</span>
        </button>
      );
    })}
  </div>
)}
```
(`formatTime`, `wsRef`, `duration` already exist in the component.)

- [ ] **Step 3: Typecheck + tests + commit**

Run: `pnpm exec tsc --noEmit && pnpm test`
```bash
git add app/recordings/[id]/transcript-player.tsx app/recordings/[id]/page.tsx
git commit -m "feat: clickable chapters that seek the waveform"
```

---

### Task 6: `speakers` + `recordingSpeakers` tables + store

**Files:**
- Modify: `db/schema.ts`
- Create: migration; `lib/speakers/store.ts`, `lib/speakers/store.test.ts`

**Interfaces:**
- Produces: `speakers` (`id`, `name` unique, `createdAt`); `recordingSpeakers` (`id`, `recordingId`, `label`, `speakerId`, unique `(recordingId,label)`). Store: `findOrCreateSpeaker(name: string): Promise<{ id: string; name: string }>`; `listSpeakers(): Promise<{ id: string; name: string }[]>`; `getRecordingSpeakerMap(recordingId: string): Promise<Record<string, string>>` (label→name); `setRecordingSpeaker(recordingId: string, label: string, name: string): Promise<void>` (blank name → remove mapping).

- [ ] **Step 1: Add tables to `db/schema.ts`**
```ts
export const speakers = pgTable("speakers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const recordingSpeakers = pgTable("recording_speakers", {
  id: uuid("id").primaryKey().defaultRandom(),
  recordingId: uuid("recording_id").notNull().references(() => recordings.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  speakerId: uuid("speaker_id").notNull().references(() => speakers.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [unique("recording_speakers_recording_label").on(t.recordingId, t.label)]);
```
(Import `unique` from `drizzle-orm/pg-core` if not present.) Run `pnpm db:generate`; confirm a migration creating both tables. Don't apply.

- [ ] **Step 2: Failing store test** (`lib/speakers/store.test.ts`, mocked in-memory db — model it on `lib/backup/store.test.ts`): assert `findOrCreateSpeaker` returns existing on a second call with the same (case-insensitive, trimmed) name; `setRecordingSpeaker` upserts a `(recordingId,label)`; blank name deletes; `getRecordingSpeakerMap` returns `{label: name}`. (Write a `calls`-style mock matching the existing store-test pattern; assert behavior, not SQL.)

- [ ] **Step 3: Implement `lib/speakers/store.ts`**
```ts
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { speakers, recordingSpeakers } from "@/db/schema";

export async function findOrCreateSpeaker(name: string) {
  const clean = name.trim();
  const existing = await db.query.speakers.findFirst({ where: eq(speakers.name, clean) });
  if (existing) return { id: existing.id, name: existing.name };
  const [row] = await db.insert(speakers).values({ name: clean }).returning();
  return { id: row.id, name: row.name };
}
export async function listSpeakers() {
  return (await db.query.speakers.findMany()).map((s) => ({ id: s.id, name: s.name }));
}
export async function getRecordingSpeakerMap(recordingId: string): Promise<Record<string, string>> {
  const rows = await db
    .select({ label: recordingSpeakers.label, name: speakers.name })
    .from(recordingSpeakers)
    .innerJoin(speakers, eq(speakers.id, recordingSpeakers.speakerId))
    .where(eq(recordingSpeakers.recordingId, recordingId));
  return Object.fromEntries(rows.map((r) => [r.label, r.name]));
}
export async function setRecordingSpeaker(recordingId: string, label: string, name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) {
    await db.delete(recordingSpeakers).where(and(eq(recordingSpeakers.recordingId, recordingId), eq(recordingSpeakers.label, label)));
    return;
  }
  const speaker = await findOrCreateSpeaker(clean);
  const existing = await db.query.recordingSpeakers.findFirst({ where: and(eq(recordingSpeakers.recordingId, recordingId), eq(recordingSpeakers.label, label)) });
  if (existing) {
    await db.update(recordingSpeakers).set({ speakerId: speaker.id }).where(eq(recordingSpeakers.id, existing.id));
  } else {
    await db.insert(recordingSpeakers).values({ recordingId, label, speakerId: speaker.id });
  }
}
```
(Name match is exact-string here; for case-insensitive dedupe, lowercase-compare in `findOrCreateSpeaker` — implement per the test you wrote. Verify the `db.select(...).innerJoin` API against the installed Drizzle; adapt if needed.)

- [ ] **Step 4: Run → pass; typecheck; commit**

Run: `pnpm test lib/speakers/store.test.ts && pnpm exec tsc --noEmit`
```bash
git add db/schema.ts drizzle/ lib/speakers/store.ts lib/speakers/store.test.ts
git commit -m "feat: add speakers directory and per-recording speaker mapping"
```

---

### Task 7: Inline speaker rename UI + PUT route + name display

**Files:**
- Create: `app/api/recordings/[id]/speakers/route.ts`
- Modify: `app/recordings/[id]/transcript-player.tsx`, `app/recordings/[id]/page.tsx`

**Interfaces:**
- Consumes: `setRecordingSpeaker`, `getRecordingSpeakerMap`, `listSpeakers` (Task 6), `nameForLabel` (Task 2).
- `PUT /api/recordings/[id]/speakers` body `{ label: string, name: string }` (session) → `setRecordingSpeaker` → 200.

- [ ] **Step 1: PUT route** (`app/api/recordings/[id]/speakers/route.ts`):
```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { setRecordingSpeaker } from "@/lib/speakers/store";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { label, name } = await request.json();
  if (typeof label !== "string" || typeof name !== "string") return NextResponse.json({ error: "label and name required" }, { status: 400 });
  await setRecordingSpeaker(id, label, name);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Pass the speaker map + directory to the player** in `page.tsx`:
```tsx
const [speakerMap, directory] = await Promise.all([getRecordingSpeakerMap(id), listSpeakers()]);
// …
<TranscriptPlayer … speakerMap={speakerMap} directory={directory.map((s) => s.name)} recordingId={id} />
```

- [ ] **Step 3: Inline rename in `transcript-player.tsx`**

Add props `speakerMap: Record<string,string>`, `directory: string[]`, `recordingId: string`. Hold `const [nameMap, setNameMap] = useState(speakerMap)`. Render each transcript segment's speaker via `nameForLabel(seg.speaker ?? "Speaker ?", nameMap)` as a small button that opens an inline `<input list="speaker-directory">` (with a `<datalist id="speaker-directory">` of `directory`); on submit, `PUT /api/recordings/${recordingId}/speakers` `{label: seg.speaker, name}`, then `setNameMap((m) => ({ ...m, [seg.speaker!]: name }))` (or delete on blank) and `router.refresh()`. Keep it minimal — a per-distinct-label editor is nicer, but per-segment is acceptable; if you build a distinct-label list, derive labels from `new Set(segments.map(s => s.speaker))`. Display uses `nameMap`.

- [ ] **Step 4: Typecheck + tests + commit**

Run: `pnpm exec tsc --noEmit && pnpm test`
```bash
git add app/api/recordings/[id]/speakers app/recordings/[id]/transcript-player.tsx app/recordings/[id]/page.tsx
git commit -m "feat: inline speaker renaming with a reusable directory"
```

---

### Task 8: Wire names into regeneration + Regenerate button

**Files:**
- Modify: `lib/pipeline.ts`
- Create: `app/api/recordings/[id]/regenerate/route.ts`, `app/recordings/[id]/regenerate-button.tsx`
- Modify: `app/recordings/[id]/page.tsx`

**Interfaces:**
- Consumes: `getRecordingSpeakerMap` (Task 6). `POST /api/recordings/[id]/regenerate` (session) → re-run enhancement → 200.

- [ ] **Step 1: Use the real speaker map in `runEnhancement`** (`lib/pipeline.ts`): replace `buildNamedTranscript(t.segments, {})` with the recording's map:
```ts
import { getRecordingSpeakerMap } from "@/lib/speakers/store";
// …
    const map = await getRecordingSpeakerMap(id).catch(() => ({}));
    const transcript = buildNamedTranscript(t.segments, map);
```
Also make regenerate replace (not duplicate) the recording's enhancement: before inserting, `await db.delete(aiEnhancements).where(eq(aiEnhancements.recordingId, id));` (keeps one row per recording). Confirm `eq`/`aiEnhancements` are imported.

- [ ] **Step 2: Regenerate route** (`app/api/recordings/[id]/regenerate/route.ts`):
```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { runEnhancement } from "@/lib/pipeline";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await runEnhancement(id); // sets status; resilient internally
  return NextResponse.json({ ok: true });
}
```
(Awaited here — a single enhancement is quick enough for a request; if you prefer fire-and-forget, mirror the backup pattern. Awaiting is simpler and lets the UI refresh on completion.)

- [ ] **Step 3: Regenerate button** (`app/recordings/[id]/regenerate-button.tsx`, `"use client"`): a button that POSTs `/api/recordings/${id}/regenerate`, shows "Regenerating…", then `router.refresh()`. Accept an optional `renamedSinceHint?: boolean` to show the hint text "Speaker names changed — regenerate to update owners & summary." (Simplest: always show the button; show the hint after a rename — you can drive the hint from a client flag set when a rename PUT succeeds, lifted via a shared parent or just always show a subtle "Renamed a speaker? Regenerate to update the summary." line near the button.)

- [ ] **Step 4: Render the button** in `page.tsx` near the summary card (only when a transcription exists). Typecheck + tests + commit.

Run: `pnpm exec tsc --noEmit && pnpm test`
```bash
git add lib/pipeline.ts app/api/recordings/[id]/regenerate app/recordings/[id]/regenerate-button.tsx app/recordings/[id]/page.tsx
git commit -m "feat: regenerate enhancement with speaker names"
```

---

### Task 9: Extend exports + docs

**Files:**
- Modify: `lib/export/markdown.ts`, `lib/export/json.ts`, their tests; `app/api/recordings/[id]/export/route.ts`; `lib/backup/build.ts`; `PROGRESS.md`

**Interfaces:**
- The serializers now take the reshaped enhancement (`overview`, structured `actionItems`, `decisions`, `chapters`, `openQuestions`) + a speaker map for name resolution.

- [ ] **Step 1: Update the serializer types + tests** — `recordingToMarkdown`/`recordingToExport` `Enh` type changes: `summary`→`overview`, `actionItems: { text; owner?; due? }[]`, add `decisions`/`chapters`/`openQuestions`. Add a `speakerMap` param (`Record<string,string>`) and resolve segment speakers via `nameForLabel` in the transcript section. Update the existing export tests for the new shape (action item renders `owner: text (due …)`; new sections present; null enhancement still "Not yet processed").

- [ ] **Step 2: Update callers** — the export route and `buildBackup` now load `getRecordingSpeakerMap(id)` and pass it + map the enhancement fields (`overview` etc.). Keep behavior otherwise identical.

- [ ] **Step 3: PROGRESS.md** — mark "Phase 2: rich AI enhancement + speaker naming" done; link the spec; note remaining Phase 2 (multi-view summaries/templates, mind maps, Ask-Engram RAG).

- [ ] **Step 4: Typecheck + full suite + commit**

Run: `pnpm exec tsc --noEmit && pnpm test`
```bash
git add lib/export app/api/recordings/[id]/export lib/backup/build.ts PROGRESS.md
git commit -m "feat: include rich enhancement + speaker names in exports; docs"
```

---

## Self-Review

**Spec coverage:** rich schema (overview/keyPoints/decisions/actionItems[owner,due]/chapters/openQuestions) → Task 1; English prompt → Task 1; enhancement reshape migration → Task 3; produce+render rich → Task 4; chapters→seek → Task 5; speakers directory + recordingSpeakers + store → Task 6; manual rename UI + non-destructive map + directory autocomplete → Task 7; names into enhancement + Regenerate (manual) + hint → Task 8; exports + names → Task 9; configurable model (unchanged) → Tasks 1/4; non-destructive naming (segments untouched, read-time substitution) → Tasks 2/7/8. All spec sections covered.

**Placeholder scan:** No "TODO/handle errors" prose. The `openQuestions` `$type` line has an inline correction note (use `string[]`). Verify-points (drizzle rename prompt, `db.select().innerJoin` API, drizzle-kit migration shape) carry concrete authoritative SQL/fallbacks. The cross-task tsc breakage (Tasks 1→4) is explicitly flagged with sequencing guidance, not a silent gap.

**Type consistency:** `Enhancement` shape (Task 1) ↔ `aiEnhancements` columns (Task 3) ↔ render (Task 4) ↔ serializers (Task 9) all use `overview` + structured `actionItems` + `decisions`/`chapters`/`openQuestions`. `buildNamedTranscript(segments, map)` / `nameForLabel(label, map)` (Task 2) consumed by pipeline (Tasks 4/8), player (Task 7), serializers (Task 9). `getRecordingSpeakerMap`→`Record<string,string>` (Task 6) feeds `buildNamedTranscript` (Task 8) and `nameForLabel` (Tasks 7/9). `setRecordingSpeaker(recordingId,label,name)` (Task 6) ↔ PUT route body (Task 7). `chapters` prop (Task 5) matches the schema's chapter shape (Task 1).
