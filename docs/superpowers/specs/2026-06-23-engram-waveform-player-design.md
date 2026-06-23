# Engram — Phase 1+ Design: Waveform Player + Click-to-Seek

**Date:** 2026-06-23
**Status:** Approved design, pre-implementation
**Scope:** First of three Phase 1+ UX slices (waveform player → full-text search → export). This spec covers only the **waveform player + two-way transcript↔audio sync** on the recording detail page.

## Goal

Replace the bare `<audio controls>` on the recording detail page with a Wavesurfer.js bar-style waveform, and link it to the transcript both ways: click a segment to seek; as audio plays, highlight + auto-scroll the active segment.

## Locked decisions

| Area | Decision |
|---|---|
| Library | `wavesurfer.js` v7 (new client dependency). |
| Waveform style | **Bars** (SoundCloud-style), moderate count: `barWidth: 3`, `barGap: 2`, `barRadius: 3` (tunable). Colors tuned to the dark UI — `waveColor` muted (e.g. `#3f3f46`), `progressColor` light/accent (e.g. `#a1a1aa`); resolved from the theme where practical, else these constants. |
| Backend | Wavesurfer **MediaElement** backend so playback streams immediately; the waveform fills in as audio loads. |
| Sync | Two-way: click segment → `setTime(start)`; `timeupdate` → highlight + `scrollIntoView` the active segment. |
| Audio source | Existing `/api/recordings/[id]/audio` (302 → presigned R2 URL; Wavesurfer follows the redirect). No API change. |
| Data | None new — uses existing `transcriptions.segments` (`{start,end,text,speaker?}`). No migration. |

## Architecture / components

- **`app/recordings/[id]/page.tsx`** (server component) — unchanged responsibilities except it now renders the new client player component for the audio+transcript region instead of the inline `<audio>` + transcript list. The summary/action-items/key-points stay server-rendered. Passes `audioSrc="/api/recordings/${id}/audio"` and `segments` (the stored jsonb) to the client component.
- **`app/recordings/[id]/transcript-player.tsx`** (new, `"use client"`) — owns:
  - Wavesurfer init in a `useEffect` (create with the bar config + MediaElement backend + `audioSrc`; destroy on unmount).
  - Play/pause button + current-time / duration display.
  - The transcript list: each segment rendered as before (`Speaker {speaker}: {text}` + timestamp), now a clickable element that calls `wavesurfer.setTime(segment.start)`.
  - A `timeupdate` subscription that computes the active segment index and applies a highlight class + `scrollIntoView({ block: "nearest", behavior: "smooth" })` when it changes.
- **`lib/transcript/active-segment.ts`** (new, pure) — `activeSegmentIndex(segments, currentTime): number` — the one piece of real logic, unit-tested. Returns the index of the segment where `start ≤ t < end`; if none matches (gaps), the last segment whose `start ≤ t`; `-1` before the first segment / empty list.

## Error handling

- No audio / decode failure: Wavesurfer surfaces an error event → show a small "Audio unavailable" message and still render the transcript (so the page degrades gracefully).
- A recording with no transcription yet (status not `transcribed`/`done`): render the player for the audio; show the existing "processing…" state instead of segments. (No active-segment logic when there are no segments.)
- Wavesurfer instance is destroyed on unmount to avoid leaks / double-init in React strict mode.

## Testing

- **`lib/transcript/active-segment.ts`** — unit tests: t before first → `-1`; t inside a segment → that index; t in a gap between segments → the last started segment; t past the end → last segment; empty list → `-1`; exact-boundary (`t === start`) → that segment.
- The Wavesurfer wiring (canvas/DOM/audio) is verified by `pnpm exec tsc --noEmit` + a manual run (no browser unit tests). 
- Full suite stays green.

## Out of scope (later)

- Precomputed/server-side waveform peaks (a performance optimization for very long files — not needed at current volume).
- Per-word highlighting (we sync at segment granularity; Scribe gives word timings but segment-level is the UX we want now).
- The other two Phase 1+ slices (search, export).

## Task order (drives the plan + PROGRESS)

1. `lib/transcript/active-segment.ts` + thorough unit tests.
2. Add `wavesurfer.js`; build `transcript-player.tsx` (bar waveform + MediaElement + play/pause + click-to-seek + active-segment highlight/scroll using the helper).
3. Wire it into `app/recordings/[id]/page.tsx` (replace inline audio + transcript with the client component; keep summary server-rendered; preserve the error/processing/retry states).
4. Typecheck + tests + manual verification note; docs/PROGRESS touch.
