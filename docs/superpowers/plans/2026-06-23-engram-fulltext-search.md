# Engram Full-Text Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/search` page that does ranked Postgres full-text search over transcript + title with XSS-safe highlighted snippets, and jumps to the first matching transcript segment when a result is opened (reusing the waveform player).

**Architecture:** A generated `tsvector` column + GIN index on `transcriptions`; a `searchRecordings()` query using `websearch_to_tsquery`/`ts_rank`/`ts_headline`; pure helpers for snippet sanitization and segment matching; a server `/search` page + client search box; and a small addition to the existing `TranscriptPlayer` to jump to the matching segment.

**Tech Stack:** Next.js 16 + TS, pnpm, Drizzle + postgres.js, Postgres FTS, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-23-engram-fulltext-search-design.md`

## Global Constraints

- **pnpm only.** Conventional commits. Clean/modular code. English UI.
- **Next.js 16:** server components default; `searchParams` is a Promise (await it); `requireSession()` guards pages; `auth.api.getSession` pattern for any route. Read `node_modules/next/dist/docs/` before Next-specific changes.
- **Root-level layout** (no `src/`); `@/* → ./*`.
- **Postgres FTS config = `simple`** (no stemming) everywhere; query parser = `websearch_to_tsquery('simple', q)`.
- **XSS:** snippets are escaped-then-marked via sentinel chars; never inject raw `ts_headline` HTML. `q` is parameter-bound in SQL (Drizzle `sql` binding), never concatenated.
- **TDD** for the pure helpers (`snippet`, `match`) and `searchRecordings`'s blank/mapping behavior. The FTS SQL and the page/player wiring are verified by `tsc` + manual run.
- **Sentinels:** `SNIPPET_START = "\u0001"`, `SNIPPET_END = "\u0002"` (control chars — never appear in transcripts, not HTML-special).

## File Structure

```
lib/search/snippet.ts        # SNIPPET_START/END + renderSnippet (escape→mark) [pure]
lib/search/snippet.test.ts
lib/search/match.ts          # firstMatchingSegmentIndex [pure]
lib/search/match.test.ts
lib/search/search.ts         # searchRecordings(q) → SearchHit[]
lib/search/search.test.ts
db/schema.ts                 # + transcriptions.searchVector (generated tsvector) + GIN index
drizzle/                     # new migration
app/search/page.tsx          # server: requireSession, run search, render
app/search/search-box.tsx    # client: input → /search?q=
app/layout.tsx               # + "Search" nav link
app/recordings/[id]/page.tsx # read ?q, pass highlightQuery to player
app/recordings/[id]/transcript-player.tsx  # + highlightQuery jump on ready
PROGRESS.md
```

---

### Task 1: Pure helpers — `renderSnippet` + `firstMatchingSegmentIndex`

**Files:**
- Create: `lib/search/snippet.ts`, `lib/search/snippet.test.ts`, `lib/search/match.ts`, `lib/search/match.test.ts`

**Interfaces:**
- Produces: `SNIPPET_START`, `SNIPPET_END` (string consts); `renderSnippet(raw: string): string`; `firstMatchingSegmentIndex(segments: { text: string }[], q: string): number`.

- [ ] **Step 1: Write the failing tests**

`lib/search/snippet.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { renderSnippet, SNIPPET_START, SNIPPET_END } from "./snippet";

const mark = (s: string) => `${SNIPPET_START}${s}${SNIPPET_END}`;

describe("renderSnippet", () => {
  it("converts sentinels to <mark>", () => {
    expect(renderSnippet(`a ${mark("cat")} b`)).toBe("a <mark>cat</mark> b");
  });
  it("escapes HTML in the source so transcripts can't inject", () => {
    expect(renderSnippet(`<script>alert(1)</script>`)).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
  it("escapes around a mark too", () => {
    expect(renderSnippet(`<b>${mark("x")}</b>`)).toBe("&lt;b&gt;<mark>x</mark>&lt;/b&gt;");
  });
  it("leaves plain text unchanged", () => {
    expect(renderSnippet("just text")).toBe("just text");
  });
});
```
`lib/search/match.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { firstMatchingSegmentIndex } from "./match";

const segs = [{ text: "Hello there" }, { text: "We discussed the budget" }, { text: "budget again" }];

describe("firstMatchingSegmentIndex", () => {
  it("finds the first segment containing the term (case-insensitive)", () => {
    expect(firstMatchingSegmentIndex(segs, "BUDGET")).toBe(1);
  });
  it("returns -1 when not found", () => {
    expect(firstMatchingSegmentIndex(segs, "zzz")).toBe(-1);
  });
  it("returns -1 for empty/whitespace query", () => {
    expect(firstMatchingSegmentIndex(segs, "  ")).toBe(-1);
  });
});
```

- [ ] **Step 2: Run tests → fail**

Run: `pnpm test lib/search/snippet.test.ts lib/search/match.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`lib/search/snippet.ts`:
```ts
// Control-char sentinels: never appear in transcript text, not HTML-special.
export const SNIPPET_START = "\u0001";
export const SNIPPET_END = "\u0002";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape the raw ts_headline output, then turn sentinels into <mark>. */
export function renderSnippet(raw: string): string {
  return escapeHtml(raw).split(SNIPPET_START).join("<mark>").split(SNIPPET_END).join("</mark>");
}
```
`lib/search/match.ts`:
```ts
export function firstMatchingSegmentIndex(segments: { text: string }[], q: string): number {
  const needle = q.trim().toLowerCase();
  if (!needle) return -1;
  return segments.findIndex((s) => s.text.toLowerCase().includes(needle));
}
```

- [ ] **Step 4: Run tests → pass; commit**

Run: `pnpm test lib/search/snippet.test.ts lib/search/match.test.ts && pnpm exec tsc --noEmit`
```bash
git add lib/search/snippet.ts lib/search/snippet.test.ts lib/search/match.ts lib/search/match.test.ts
git commit -m "feat: add search snippet sanitizer and segment matcher helpers"
```

---

### Task 2: `searchVector` generated column + GIN index

**Files:**
- Modify: `db/schema.ts`
- Create: migration in `drizzle/`

**Interfaces:**
- Produces: `transcriptions.search_vector` (`tsvector`, `GENERATED ALWAYS AS (to_tsvector('simple', coalesce(full_text,''))) STORED`) + GIN index `idx_transcriptions_search`.

- [ ] **Step 1: Add to `db/schema.ts`**

At the top of the file's imports add `customType`, `sql`, and `index` (some may already be imported — `index` is). Define the tsvector type near the top (after imports):
```ts
import { customType, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});
```
Add the generated column to the `transcriptions` table definition and a GIN index in the table's second-arg callback:
```ts
export const transcriptions = pgTable(
  "transcriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recordingId: uuid("recording_id").notNull().references(() => recordings.id, { onDelete: "cascade" }),
    fullText: text("full_text").notNull(),
    rawText: text("raw_text"),
    language: text("language"),
    segments: jsonb("segments").notNull().$type<{ start: number; end: number; text: string; speaker?: string }[]>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(full_text, ''))`,
    ),
  },
  (t) => ({
    searchIdx: index("idx_transcriptions_search").using("gin", t.searchVector),
  }),
);
```
(Keep any other imports/usages intact. If `customType`/`index`/`sql` are already imported elsewhere in the file, don't duplicate.)

- [ ] **Step 2: Generate the migration + verify the SQL**

Run: `pnpm db:generate`
Then OPEN the generated `drizzle/000N_*.sql` and confirm it contains both:
- `ALTER TABLE "transcriptions" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(full_text, ''))) STORED;`
- `CREATE INDEX "idx_transcriptions_search" ON "transcriptions" USING gin ("search_vector");`

If drizzle-kit did NOT emit the `GENERATED ALWAYS AS … STORED` clause or the GIN index correctly (its tsvector/generated support can be partial), **hand-edit the migration SQL** to exactly the two statements above. Keep the schema declaration from Step 1 either way (so types + future diffs line up). Do NOT run `db:migrate` (no DB here; applied on deploy). Note in your report which path you took.

- [ ] **Step 3: Typecheck + tests + commit**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: clean + green (existing suite unaffected).
```bash
git add db/schema.ts drizzle/
git commit -m "feat: add transcriptions.search_vector generated tsvector + GIN index"
```

---

### Task 3: `searchRecordings` FTS query

**Files:**
- Create: `lib/search/search.ts`, `lib/search/search.test.ts`

**Interfaces:**
- Consumes: `db` (`@/db`), `renderSnippet`/`SNIPPET_START`/`SNIPPET_END` (Task 1).
- Produces: `SearchHit = { id: string; title: string; createdAt: Date; snippet: string }`; `searchRecordings(q: string): Promise<SearchHit[]>`.

- [ ] **Step 1: Write the failing test**

`lib/search/search.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SNIPPET_START, SNIPPET_END } from "./snippet";

const execute = vi.fn();
vi.mock("@/db", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));

beforeEach(() => execute.mockReset());

describe("searchRecordings", () => {
  it("returns [] for a blank query without hitting the db", async () => {
    const { searchRecordings } = await import("./search");
    expect(await searchRecordings("   ")).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });
  it("maps rows and renders snippets", async () => {
    execute.mockResolvedValueOnce([
      { id: "r1", title: "Sync", created_at: "2026-06-01T10:00:00Z", snippet: `the ${SNIPPET_START}budget${SNIPPET_END} talk` },
    ]);
    const { searchRecordings } = await import("./search");
    const hits = await searchRecordings("budget");
    expect(execute).toHaveBeenCalledOnce();
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ id: "r1", title: "Sync", snippet: "the <mark>budget</mark> talk" });
    expect(hits[0].createdAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Run test → fails**

Run: `pnpm test lib/search/search.test.ts`
Expected: FAIL (`Cannot find module './search'`).

- [ ] **Step 3: Implement `lib/search/search.ts`**

```ts
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { renderSnippet, SNIPPET_START, SNIPPET_END } from "./snippet";

export interface SearchHit {
  id: string;
  title: string;
  createdAt: Date;
  snippet: string;
}

const HEADLINE_OPTS = `StartSel=${SNIPPET_START}, StopSel=${SNIPPET_END}, MaxFragments=2, MinWords=5, MaxWords=18, FragmentDelimiter= … `;

export async function searchRecordings(q: string): Promise<SearchHit[]> {
  const query = q.trim();
  if (!query) return [];

  const rows = (await db.execute(sql`
    SELECT r.id AS id,
           r.title AS title,
           r.created_at AS created_at,
           ts_headline('simple', t.full_text, websearch_to_tsquery('simple', ${query}), ${HEADLINE_OPTS}) AS snippet
    FROM transcriptions t
    JOIN recordings r ON r.id = t.recording_id
    WHERE t.search_vector @@ websearch_to_tsquery('simple', ${query})
       OR to_tsvector('simple', r.title) @@ websearch_to_tsquery('simple', ${query})
    ORDER BY ts_rank(t.search_vector, websearch_to_tsquery('simple', ${query})) DESC
    LIMIT 20
  `)) as unknown as Array<{ id: string; title: string; created_at: string | Date; snippet: string | null }>;

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: new Date(row.created_at),
    snippet: renderSnippet(row.snippet ?? ""),
  }));
}
```
**Verify the `db.execute` return shape** against the installed drizzle + postgres-js: with the postgres-js driver, `db.execute(sql\`…\`)` resolves to the **rows array** directly. If your version instead returns `{ rows }`, change the destructure accordingly (and note it). Tests mock `db.execute` to return an array, matching the postgres-js shape.

- [ ] **Step 4: Run test → passes; typecheck; commit**

Run: `pnpm test lib/search/search.test.ts && pnpm exec tsc --noEmit`
```bash
git add lib/search/search.ts lib/search/search.test.ts
git commit -m "feat: add searchRecordings full-text query"
```

---

### Task 4: `/search` page + search box + nav link

**Files:**
- Create: `app/search/page.tsx`, `app/search/search-box.tsx`
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: `requireSession`, `searchRecordings` (Task 3).

- [ ] **Step 1: Read the Next.js 16 searchParams doc**

Run `ls node_modules/next/dist/docs/` and confirm page `searchParams` is a `Promise` in this version (awaited), matching the recordings detail page's `params` pattern.

- [ ] **Step 2: Create `app/search/search-box.tsx`**

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SearchBox({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        router.push(`/search?q=${encodeURIComponent(q.trim())}`);
      }}
      className="flex gap-2"
    >
      <Input placeholder="Search transcripts…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <Button type="submit" disabled={q.trim().length === 0}>Search</Button>
    </form>
  );
}
```

- [ ] **Step 3: Create `app/search/page.tsx`**

```tsx
import Link from "next/link";
import { requireSession } from "@/lib/auth-guard";
import { searchRecordings } from "@/lib/search/search";
import { SearchBox } from "./search-box";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireSession();
  const { q = "" } = await searchParams;
  const query = q.trim();
  const results = query ? await searchRecordings(query) : [];

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Search</h1>
      <SearchBox initialQuery={q} />

      {query && results.length === 0 && <p className="text-sm text-muted-foreground">No matches.</p>}

      <ul className="flex flex-col gap-4">
        {results.map((hit) => (
          <li key={hit.id}>
            <Link href={`/recordings/${hit.id}?q=${encodeURIComponent(query)}`} className="block hover:underline">
              <div className="font-medium">{hit.title}</div>
              <div className="text-xs text-muted-foreground">
                {new Date(hit.createdAt).toLocaleDateString("en-GB")}
              </div>
            </Link>
            <p
              className="mt-1 text-sm text-muted-foreground [&_mark]:bg-yellow-500/30 [&_mark]:text-foreground"
              dangerouslySetInnerHTML={{ __html: hit.snippet }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
```
(The snippet is the sanitized output of `renderSnippet` — escaped text with `<mark>` only — so `dangerouslySetInnerHTML` is safe here.)

- [ ] **Step 4: Add the "Search" nav link in `app/layout.tsx`**

After the `/upload` link (and before `/settings`), add, matching the existing link markup:
```tsx
            <Link
              href="/search"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Search
            </Link>
```

- [ ] **Step 5: Typecheck + tests + commit**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: clean + green.
```bash
git add app/search app/layout.tsx
git commit -m "feat: add /search page, search box, and nav link"
```

---

### Task 5: Deep-link — jump to the matching segment

**Files:**
- Modify: `app/recordings/[id]/page.tsx`, `app/recordings/[id]/transcript-player.tsx`

**Interfaces:**
- Consumes: `firstMatchingSegmentIndex` (Task 1).
- Produces: `TranscriptPlayer` gains an optional `highlightQuery?: string` prop.

- [ ] **Step 1: Pass `?q` from the detail page**

In `app/recordings/[id]/page.tsx`, change the props to also read `searchParams`, await it, and pass it to the player. The component currently destructures `{ params }`; update to:
```tsx
export default async function RecordingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  await requireSession();
  const { id } = await params;
  const { q } = await searchParams;
  // …existing data load…
```
And pass the prop where `<TranscriptPlayer>` is rendered:
```tsx
      <TranscriptPlayer
        audioSrc={`/api/recordings/${id}/audio`}
        segments={transcription?.segments ?? []}
        highlightQuery={q}
      />
```

- [ ] **Step 2: Add the jump to `app/recordings/[id]/transcript-player.tsx`**

Add `highlightQuery?: string` to the component's props type and import the helper:
```tsx
import { firstMatchingSegmentIndex } from "@/lib/search/match";
// props: { audioSrc: string; segments: Segment[]; highlightQuery?: string }
```
Inside the init `useEffect`, in the existing `ws.on("ready", …)` handler (which already sets duration), add the jump (using `segmentsRef.current` so it reads current segments):
```ts
    ws.on("ready", () => {
      setDuration(ws.getDuration());
      if (highlightQuery) {
        const idx = firstMatchingSegmentIndex(segmentsRef.current, highlightQuery);
        if (idx >= 0) {
          setActive(idx);
          ws.setTime(segmentsRef.current[idx].start);
        }
      }
    });
```
The existing `[active]` effect already does `scrollIntoView`, so setting `active` scrolls the segment into view. `highlightQuery` is a stable server-provided prop captured in the init closure (the init effect's deps stay `[audioSrc]`). If a segment matches, the page opens seeked + highlighted at that segment; if none matches (`-1`), the player opens normally.

- [ ] **Step 3: Typecheck + tests + manual note**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: clean + green. Manual (at run-time): search a word, click a result → the recording opens scrolled/highlighted/seeked to the first segment containing it.

- [ ] **Step 4: Commit**

```bash
git add app/recordings/[id]/page.tsx app/recordings/[id]/transcript-player.tsx
git commit -m "feat: jump to the matching transcript segment from a search result"
```

---

### Task 6: Docs

**Files:**
- Modify: `PROGRESS.md`

- [ ] **Step 1: Update `PROGRESS.md`** — under Phase 1+, mark "Full-text search" done; link the spec `docs/superpowers/specs/2026-06-23-engram-fulltext-search-design.md`; note the last Phase 1+ slice (export) still pending.

- [ ] **Step 2: Typecheck + suite + commit**

Run: `pnpm exec tsc --noEmit && pnpm test`
```bash
git add PROGRESS.md
git commit -m "chore: mark full-text search slice done in PROGRESS"
```

---

## Self-Review

**Spec coverage:** Postgres FTS `simple` + GIN tsvector → Task 2. `websearch_to_tsquery`/`ts_rank`/`ts_headline` → Task 3. Transcript+title scope → Task 3 (`search_vector` OR title). XSS-safe sentinel snippets → Task 1 (`renderSnippet`) + Task 3 (`HEADLINE_OPTS`). `/search` page + box + nav → Task 4. Deep-link to first matching segment via the player → Tasks 1 (`firstMatchingSegmentIndex`) + 5. Top-20/blank-query → Task 3. `requireSession` + param-bound `q` (no injection) → Tasks 3/4. Docs → Task 6. All spec sections covered.

**Placeholder scan:** No "TODO/handle errors" instructions. Two flagged verify-points (Drizzle tsvector-generated DSL → raw-SQL fallback; `db.execute` return shape) have concrete code + a stated fallback — not vague placeholders.

**Type consistency:** `SNIPPET_START`/`SNIPPET_END`/`renderSnippet` (Task 1) consumed in Task 3 (`HEADLINE_OPTS` + mapping). `firstMatchingSegmentIndex(segments: {text}[], q)` (Task 1) consumed in Task 5 with `segmentsRef.current` (the `Segment[]` from the player, which has `text`). `SearchHit` shape (Task 3) consumed by the page (Task 4: `hit.id/title/createdAt/snippet`). `searchRecordings(q)` signature consistent (Tasks 3/4). `TranscriptPlayer` gains `highlightQuery?` (Task 5) — matches the page's new prop pass. The detail page's existing `requireSession`/`params` usage is preserved; `searchParams` added alongside.
