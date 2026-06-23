# Engram Waveform Player + Click-to-Seek Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare `<audio>` on the recording detail page with a Wavesurfer.js rounded-bar waveform, two-way-synced to the transcript (click a segment to seek; highlight + auto-scroll the active segment during playback).

**Architecture:** A pure `activeSegmentIndex` helper (the only unit-tested logic) plus a new `"use client"` `transcript-player.tsx` that owns the Wavesurfer instance + transcript list. The detail page stays a server component for the summary and hands the player `audioSrc` + `segments`.

**Tech Stack:** Next.js 16 + TS, pnpm, `wavesurfer.js` v7, Vitest. No DB/API change.

**Spec:** `docs/superpowers/specs/2026-06-23-engram-waveform-player-design.md`

## Global Constraints

- **pnpm only.** Conventional commits. Clean/modular code. English UI.
- **Next.js 16:** server components default; only the player is `"use client"`. The page already uses async `params`. Read `node_modules/next/dist/docs/` before Next-specific changes.
- **Root-level layout** (no `src/`); `@/* → ./*`.
- **TDD** for the pure helper. The Wavesurfer component is browser/canvas — NOT unit-tested; verified by `pnpm exec tsc --noEmit` + manual run.
- **Waveform = rounded bars with comfortable spacing** (not a dense solid wave). Starting point `barWidth: 3, barGap: 2, barRadius: 3`, tunable by eye. Dark-UI colors: `waveColor` muted (`#3f3f46`), `progressColor`/`cursorColor` light (`#a1a1aa`).
- **Streaming playback:** use Wavesurfer v7's MediaElement path (pass a `media` HTMLAudioElement) so playback starts without waiting on a full decode. Verify the exact v7 option names (`media`, event names `timeupdate`/`play`/`pause`/`error`, `setTime`, `playPause`, `getDuration`) against the installed `wavesurfer.js` types/README; the code below matches v7 but confirm before relying on it.
- **Graceful degradation:** if audio errors, show "Audio unavailable" and still render the transcript; if a recording isn't transcribed yet, render the player but no segments.

## File Structure

```
lib/transcript/active-segment.ts       # pure activeSegmentIndex (+ SegmentTiming type)
lib/transcript/active-segment.test.ts
app/recordings/[id]/transcript-player.tsx   # NEW "use client": waveform + transcript sync
app/recordings/[id]/page.tsx                # MODIFY: render <TranscriptPlayer>, drop inline audio+transcript+formatTime
package.json                                # + wavesurfer.js
```

---

### Task 1: `activeSegmentIndex` pure helper

**Files:**
- Create: `lib/transcript/active-segment.ts`, `lib/transcript/active-segment.test.ts`

**Interfaces:**
- Produces: `SegmentTiming = { start: number; end: number }`; `activeSegmentIndex(segments: SegmentTiming[], currentTime: number): number` — index of the segment where `start ≤ t < end`; on a gap or past the end, the last segment that has started; `-1` before the first segment or for an empty list.

- [ ] **Step 1: Write the failing test**

`lib/transcript/active-segment.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { activeSegmentIndex } from "./active-segment";

const segs = [
  { start: 0, end: 2 },
  { start: 2, end: 4 },
  { start: 6, end: 8 }, // gap 4–6
];

describe("activeSegmentIndex", () => {
  it("returns -1 before the first segment", () => {
    expect(activeSegmentIndex(segs, -1)).toBe(-1);
  });
  it("returns the segment containing t", () => {
    expect(activeSegmentIndex(segs, 1)).toBe(0);
    expect(activeSegmentIndex(segs, 3)).toBe(1);
    expect(activeSegmentIndex(segs, 7)).toBe(2);
  });
  it("treats start as inclusive, end as exclusive", () => {
    expect(activeSegmentIndex(segs, 2)).toBe(1); // == seg1.start
    expect(activeSegmentIndex(segs, 4)).toBe(1); // == seg1.end, in the gap → last started
  });
  it("returns the last started segment within a gap", () => {
    expect(activeSegmentIndex(segs, 5)).toBe(1);
  });
  it("returns the last segment past the end", () => {
    expect(activeSegmentIndex(segs, 100)).toBe(2);
  });
  it("returns -1 for an empty list", () => {
    expect(activeSegmentIndex([], 5)).toBe(-1);
  });
});
```

- [ ] **Step 2: Run test → fails**

Run: `pnpm test lib/transcript/active-segment.test.ts`
Expected: FAIL (`Cannot find module './active-segment'`).

- [ ] **Step 3: Implement `lib/transcript/active-segment.ts`**

```ts
export interface SegmentTiming {
  start: number;
  end: number;
}

/**
 * Index of the segment "active" at currentTime:
 *  - the segment where start <= t < end, else
 *  - the last segment that has started (handles gaps between segments and t past the end), else
 *  - -1 (t before the first segment, or empty list).
 */
export function activeSegmentIndex(segments: SegmentTiming[], currentTime: number): number {
  let lastStarted = -1;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (currentTime >= s.start && currentTime < s.end) return i;
    if (currentTime >= s.start) lastStarted = i;
  }
  return lastStarted;
}
```

- [ ] **Step 4: Run test → passes; commit**

Run: `pnpm test lib/transcript/active-segment.test.ts && pnpm exec tsc --noEmit`
```bash
git add lib/transcript/active-segment.ts lib/transcript/active-segment.test.ts
git commit -m "feat: add activeSegmentIndex helper for transcript-audio sync"
```

---

### Task 2: Wavesurfer player component + wire into the detail page

**Files:**
- Modify: `package.json` (dep), `app/recordings/[id]/page.tsx`
- Create: `app/recordings/[id]/transcript-player.tsx`

**Interfaces:**
- Consumes: `activeSegmentIndex` (Task 1); the existing `/api/recordings/[id]/audio` route; `transcriptions.segments` (`{start,end,text,speaker?}[]`).
- Produces: `TranscriptPlayer({ audioSrc, segments }: { audioSrc: string; segments: { start: number; end: number; text: string; speaker?: string | null }[] })` (default export or named — used only by the detail page).

- [ ] **Step 1: Install Wavesurfer**

```bash
pnpm add wavesurfer.js
```
Then confirm the installed major is v7 and skim its types/README for the `create` options + event names used below (`media`, `timeupdate`, `play`, `pause`, `error`, `setTime`, `playPause`, `getCurrentTime`). Adjust the code in Step 2 if the installed version differs; do not invent options.

- [ ] **Step 2: Create `app/recordings/[id]/transcript-player.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { activeSegmentIndex } from "@/lib/transcript/active-segment";

type Segment = { start: number; end: number; text: string; speaker?: string | null };

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function TranscriptPlayer({ audioSrc, segments }: { audioSrc: string; segments: Segment[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const segmentRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState(false);

  // Init Wavesurfer once. `audioSrc` is stable for the page's lifetime; `segments`
  // is a server-serialized prop with stable identity, so this effect runs once.
  useEffect(() => {
    if (!containerRef.current) return;
    const media = document.createElement("audio");
    media.src = audioSrc; // streaming playback via the MediaElement path
    media.preload = "metadata";

    const ws = WaveSurfer.create({
      container: containerRef.current,
      media, // v7: use this media element (streams; no full pre-decode for playback)
      height: 64,
      waveColor: "#3f3f46",
      progressColor: "#a1a1aa",
      cursorColor: "#a1a1aa",
      barWidth: 3,
      barGap: 2,
      barRadius: 3,
    });
    wsRef.current = ws;

    const onTime = (t: number) => {
      setCurrentTime(t);
      setActive(activeSegmentIndex(segments, t));
    };
    ws.on("timeupdate", onTime);
    ws.on("play", () => setPlaying(true));
    ws.on("pause", () => setPlaying(false));
    ws.on("error", () => setError(true));

    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  }, [audioSrc, segments]);

  // Auto-scroll the active segment into view as it changes.
  useEffect(() => {
    if (active >= 0) {
      segmentRefs.current[active]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [active]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => wsRef.current?.playPause()}
          className="rounded-md border px-3 py-1 text-sm hover:bg-muted"
        >
          {playing ? "Pause" : "Play"}
        </button>
        <span className="text-xs text-muted-foreground tabular-nums">{formatTime(currentTime)}</span>
      </div>

      <div ref={containerRef} className="w-full" />
      {error && <p className="text-sm text-destructive">Audio unavailable.</p>}

      {segments.length > 0 && (
        <div className="mt-2 flex max-h-96 flex-col gap-1 overflow-y-auto text-sm font-mono">
          {segments.map((seg, i) => (
            <button
              type="button"
              key={i}
              ref={(el) => {
                segmentRefs.current[i] = el;
              }}
              onClick={() => wsRef.current?.setTime(seg.start)}
              className={`cursor-pointer rounded px-1 text-left ${i === active ? "bg-muted" : ""}`}
            >
              <span className="text-muted-foreground text-xs">{formatTime(seg.start)}</span>{" "}
              <span className="font-medium">Speaker {seg.speaker ?? "?"}</span>
              {": "}
              {seg.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```
(Tune `barWidth`/`barGap`/`barRadius`/`height` and colors by eye for a clean rounded-bar look — these are a starting point.)

- [ ] **Step 3: Wire it into `app/recordings/[id]/page.tsx`**

Add the import and replace the inline `<audio>` (line ~53) AND the Transcript card (lines ~108–131) with the player; delete the now-unused `formatTime` at the bottom of the page (it moved into the component). Keep the back-link, title, error card, and summary card exactly as they are.
```tsx
import { TranscriptPlayer } from "./transcript-player";
// …
// remove: <audio controls src={`/api/recordings/${id}/audio`} className="w-full" />
// remove: the entire {transcription && ( <Card>…Transcript…</Card> )} block
// remove: the trailing `function formatTime(...) {…}`
```
Insert the player where the `<audio>` was (it carries the transcript itself):
```tsx
      <TranscriptPlayer
        audioSrc={`/api/recordings/${id}/audio`}
        segments={transcription?.segments ?? []}
      />
```
Keep the summary card between/around as before (order: back-link → title → player → error card → summary card). If a recording has no transcription yet, `segments` is `[]` and the player shows just the waveform + controls.

- [ ] **Step 4: Typecheck + tests + manual verification**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: clean + green (the new helper test + existing suite). Then a manual note in the report: on a real recording the waveform renders as rounded bars, play/pause works, clicking a segment seeks, and the active segment highlights + scrolls during playback. (Manual step happens at deploy/local-run; not blocking the task commit.)

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml app/recordings/[id]/transcript-player.tsx app/recordings/[id]/page.tsx
git commit -m "feat: add Wavesurfer waveform player with two-way transcript sync"
```

---

### Task 3: Docs

**Files:**
- Modify: `PROGRESS.md`

- [ ] **Step 1: Update `PROGRESS.md`**

Under Phase 1+, mark "Waveform player + click-to-seek" done; link the spec `docs/superpowers/specs/2026-06-23-engram-waveform-player-design.md`; note the remaining Phase 1+ slices (full-text search, export) still pending.

- [ ] **Step 2: Typecheck + suite + commit**

Run: `pnpm exec tsc --noEmit && pnpm test`
```bash
git add PROGRESS.md
git commit -m "chore: mark waveform player slice done in PROGRESS"
```

---

## Self-Review

**Spec coverage:** Wavesurfer bar waveform → Task 2 (config). MediaElement streaming → Task 2 (`media`). Click-to-seek → Task 2 (`setTime(seg.start)`). Active-segment highlight + auto-scroll → Task 2 (`timeupdate` → `activeSegmentIndex` → class + `scrollIntoView`). Pure testable helper → Task 1. Component split (summary stays server) → Task 2 Step 3. Graceful degradation (audio error / no transcription) → Task 2 (`error` state, `segments ?? []`). No schema/API change → confirmed. Docs → Task 3. All spec sections covered.

**Placeholder scan:** No "TODO/handle errors" instructions. The Wavesurfer v7 API is flagged as a verify-against-installed-types point with concrete v7 code, not a vague placeholder.

**Type consistency:** `SegmentTiming`/`activeSegmentIndex` (Task 1) consumed in Task 2. `TranscriptPlayer({ audioSrc, segments })` signature matches the page's usage (Task 2 Step 3); `segments` typed `{start,end,text,speaker?:string|null}[]` matches the stored `transcriptions.segments` shape (`speaker?` is optional/nullable). `formatTime` moved into the component (removed from the page to avoid an unused-function/duplication). The page passes `transcription?.segments ?? []` — matches the empty-list path the helper handles (`-1`).
