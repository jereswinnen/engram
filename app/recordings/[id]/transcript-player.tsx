"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import WaveSurfer from "wavesurfer.js"
import {
  RiForward15Line,
  RiListUnordered,
  RiPauseFill,
  RiPlayFill,
  RiReplay15Line,
  RiSearchLine,
} from "@remixicon/react"
import { activeSegmentIndex } from "@/lib/transcript/active-segment"
import { firstMatchingSegmentIndex } from "@/lib/search/match"
import { nameForLabel } from "@/lib/transcript/speaker-names"
import { WaveformShader } from "./waveform-shader"

type Segment = {
  start: number
  end: number
  text: string
  speaker?: string | null
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

function waveformEnergyAtTime(buffer: AudioBuffer | null, seconds: number) {
  if (!buffer || buffer.duration <= 0 || buffer.length === 0) return 0

  const channel = buffer.getChannelData(0)
  const center = Math.floor((seconds / buffer.duration) * channel.length)
  const radius = Math.max(32, Math.floor(buffer.sampleRate * 0.018))
  const stride = Math.max(1, Math.floor(radius / 72))
  const start = Math.max(0, center - radius)
  const end = Math.min(channel.length, center + radius)
  let total = 0
  let count = 0

  for (let index = start; index < end; index += stride) {
    total += channel[index] * channel[index]
    count += 1
  }

  return count > 0 ? Math.min(1, Math.sqrt(total / count) * 3.6) : 0
}

type Chapter = { title: string; gist: string; startSeconds?: number | null }

export function TranscriptPlayer({
  audioSrc,
  segments,
  highlightQuery,
  initialTime,
  chapters,
  speakerMap = {},
  directory = [],
  recordingId = "",
}: {
  audioSrc: string
  segments: Segment[]
  highlightQuery?: string
  initialTime?: number
  chapters?: Chapter[]
  speakerMap?: Record<string, string>
  directory?: string[]
  recordingId?: string
}) {
  const router = useRouter()
  const { resolvedTheme } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const segmentRefs = useRef<Array<HTMLButtonElement | null>>([])
  const searchRef = useRef<HTMLInputElement>(null)
  const segmentsRef = useRef(segments)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [waveformEnergy, setWaveformEnergy] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [transcriptSearch, setTranscriptSearch] = useState("")
  const [active, setActive] = useState(-1)
  const [error, setError] = useState(false)
  const [nameMap, setNameMap] = useState<Record<string, string>>(speakerMap)
  // editingLabel: the diarized label currently being renamed (e.g. "SPEAKER_00")
  const [editingLabel, setEditingLabel] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")
  // cancelledRef: true when Escape was pressed — tells onBlur to skip the submit
  const cancelledRef = useRef(false)
  // submittingRef: true while submitRename is running — prevents double-PUT (Enter then blur)
  const submittingRef = useRef(false)

  // Sync segmentsRef with the latest segments prop.
  useEffect(() => {
    segmentsRef.current = segments
  })

  useEffect(() => {
    function focusTranscriptSearch(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener("keydown", focusTranscriptSearch)
    return () => window.removeEventListener("keydown", focusTranscriptSearch)
  }, [])

  // Init Wavesurfer once. `audioSrc` is stable for the page's lifetime.
  // Decouple from segments to avoid re-initialization on prop identity change.
  useEffect(() => {
    if (!containerRef.current) return
    const media = document.createElement("audio")
    media.src = audioSrc // streaming playback via the MediaElement path
    media.preload = "metadata"

    const styles = getComputedStyle(document.documentElement)
    const ws = WaveSurfer.create({
      container: containerRef.current,
      media, // v7: use this media element (streams; no full pre-decode for playback)
      height: 36,
      waveColor: styles.getPropertyValue("--wave").trim(),
      progressColor: styles.getPropertyValue("--wave-progress").trim(),
      cursorColor: styles.getPropertyValue("--wave-progress").trim(),
      barWidth: 1.5,
      barGap: 1.5,
      barRadius: 2,
    })
    wsRef.current = ws

    const onTime = (t: number) => {
      setCurrentTime(t)
      setActive(activeSegmentIndex(segmentsRef.current, t))
      setWaveformEnergy(waveformEnergyAtTime(ws.getDecodedData(), t))
    }
    ws.on("timeupdate", onTime)
    ws.on("ready", () => {
      setDuration(ws.getDuration())
      if (initialTime !== undefined) {
        ws.setTime(initialTime)
        setActive(activeSegmentIndex(segmentsRef.current, initialTime))
      } else if (highlightQuery) {
        const idx = firstMatchingSegmentIndex(
          segmentsRef.current,
          highlightQuery
        )
        if (idx >= 0) {
          setActive(idx)
          ws.setTime(segmentsRef.current[idx].start)
        }
      }
    })
    ws.on("play", () => setPlaying(true))
    ws.on("pause", () => setPlaying(false))
    ws.on("error", () => setError(true))

    return () => {
      ws.destroy()
      wsRef.current = null
    }
  }, [audioSrc, highlightQuery, initialTime, resolvedTheme])

  // Auto-scroll the active segment into view as it changes.
  useEffect(() => {
    if (active >= 0) {
      segmentRefs.current[active]?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      })
    }
  }, [active])

  async function submitRename(label: string, name: string) {
    // Fix 2: guard against double-fire (Enter → onSubmit → setEditingLabel(null) → onBlur)
    if (submittingRef.current) return
    submittingRef.current = true
    setEditingLabel(null)
    try {
      const trimmed = name.trim()
      const res = await fetch(`/api/recordings/${recordingId}/speakers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, name: trimmed }),
      })
      // Fix 3: only apply optimistic update when the server accepted the change
      if (!res.ok) return
      if (trimmed) {
        setNameMap((m) => ({ ...m, [label]: trimmed }))
      } else {
        setNameMap((m) => {
          const next = { ...m }
          delete next[label]
          return next
        })
      }
      router.refresh()
    } finally {
      submittingRef.current = false
    }
  }

  function seekBy(delta: number) {
    const next = Math.max(0, Math.min(duration, currentTime + delta))
    wsRef.current?.setTime(next)
  }

  function cyclePlaybackRate() {
    const rates = [1, 1.25, 1.5, 2]
    const next = rates[(rates.indexOf(playbackRate) + 1) % rates.length]
    wsRef.current?.setPlaybackRate(next)
    setPlaybackRate(next)
  }

  const transcriptQuery = transcriptSearch.trim().toLocaleLowerCase()
  const visibleSegments = segments
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) =>
      transcriptQuery
        ? `${nameForLabel(segment.speaker ?? "Speaker ?", nameMap)} ${segment.text}`
            .toLocaleLowerCase()
            .includes(transcriptQuery)
        : true
    )

  return (
    <div className="flex min-w-0 flex-col gap-3.5 xl:h-full xl:min-h-0">
      <div className="flex min-w-0 items-center gap-1.5 rounded-2xl border bg-card p-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.025)] sm:gap-2">
        <button
          type="button"
          onClick={() => wsRef.current?.playPause()}
          aria-label={playing ? "Pause" : "Play"}
          className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition hover:bg-primary/80 active:scale-[0.98]"
        >
          {playing ? (
            <RiPauseFill className="size-4.5" />
          ) : (
            <RiPlayFill className="ml-0.5 size-4.5" />
          )}
        </button>
        <button
          type="button"
          onClick={() => seekBy(-15)}
          aria-label="Back 15 seconds"
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <RiReplay15Line className="size-4" />
        </button>
        <button
          type="button"
          onClick={cyclePlaybackRate}
          aria-label={`Playback speed ${playbackRate}x`}
          className="h-8 shrink-0 rounded-lg px-1.5 text-[10px] font-medium tabular-nums transition-colors hover:bg-muted"
        >
          {playbackRate}x
        </button>
        <button
          type="button"
          onClick={() => seekBy(15)}
          aria-label="Forward 15 seconds"
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <RiForward15Line className="size-4" />
        </button>

        <div className="relative mx-1 h-9 min-w-16 flex-1 overflow-hidden rounded-lg">
          <WaveformShader
            progress={duration > 0 ? currentTime / duration : 0}
            energy={waveformEnergy}
            playing={playing}
            dark={resolvedTheme === "dark"}
          />
          <div className="relative z-10 h-full" ref={containerRef} />
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>

      {error && <p className="text-sm text-destructive">Audio unavailable.</p>}

      {segments.length > 0 && (
        <>
          {directory.length > 0 && (
            <datalist id="speaker-directory">
              {directory.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          )}
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <RiSearchLine className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchRef}
                type="search"
                value={transcriptSearch}
                onChange={(event) => setTranscriptSearch(event.target.value)}
                placeholder="Search transcript"
                aria-label="Search transcript"
                className="h-9 w-full rounded-xl border bg-card pr-16 pl-9 text-xs shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-colors outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/15"
              />
              <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border bg-muted/45 px-1.5 py-0.5 font-sans text-[9px] text-muted-foreground">
                ⌘F
              </kbd>
            </div>
            {chapters && chapters.length > 0 && (
              <details className="group relative shrink-0">
                <summary className="flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-xl border bg-card px-2.5 text-xs font-medium shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-colors marker:hidden hover:bg-muted">
                  <RiListUnordered className="size-3.5 text-muted-foreground" />
                  <span className="hidden sm:inline">Chapters</span>
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {chapters.length}
                  </span>
                </summary>
                <div className="absolute top-10 right-0 z-30 flex max-h-72 w-[min(32rem,calc(100vw-2rem))] flex-col gap-0.5 overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg">
                  {chapters.map((chapter, index) => {
                    const seekable =
                      chapter.startSeconds != null &&
                      chapter.startSeconds >= 0 &&
                      (duration === 0 || chapter.startSeconds <= duration)
                    return (
                      <button
                        key={index}
                        type="button"
                        disabled={!seekable}
                        onClick={() => {
                          if (seekable)
                            wsRef.current?.setTime(chapter.startSeconds!)
                        }}
                        className="rounded-lg px-2.5 py-2 text-left text-xs leading-4.5 transition-colors hover:bg-muted disabled:opacity-60"
                      >
                        {chapter.startSeconds != null && (
                          <span className="mr-1.5 text-[10px] text-muted-foreground tabular-nums">
                            {formatTime(chapter.startSeconds)}
                          </span>
                        )}
                        <span className="font-medium">{chapter.title}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          — {chapter.gist}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </details>
            )}
          </div>
          <div className="flex min-h-80 flex-col gap-0.5 overflow-y-auto pr-1 text-sm xl:min-h-0 xl:flex-1">
            {visibleSegments.map(({ segment: seg, index: i }) => {
              const label = seg.speaker ?? ""
              const displayName = nameForLabel(label || "Speaker ?", nameMap)
              const isEditing = editingLabel === label && label !== ""
              return (
                <div
                  key={i}
                  className={`grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3 rounded-xl border px-3 py-3 transition-[background-color,border-color,box-shadow] ${i === active ? "border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.025)]" : "border-transparent hover:border-border/70 hover:bg-card/70"}`}
                >
                  <button
                    type="button"
                    ref={(el) => {
                      segmentRefs.current[i] = el
                    }}
                    onClick={() => wsRef.current?.setTime(seg.start)}
                    className="cursor-pointer self-start text-left"
                  >
                    <span
                      className={`text-[11px] tabular-nums ${i === active ? "font-medium text-foreground" : "text-muted-foreground"}`}
                    >
                      {formatTime(seg.start)}
                    </span>
                  </button>
                  <div className="min-w-0 text-[13px] leading-5.5">
                    {isEditing ? (
                      <form
                        className="mb-0.5 inline-flex items-center gap-1"
                        onSubmit={(e) => {
                          e.preventDefault()
                          void submitRename(label, editValue)
                        }}
                      >
                        <input
                          autoFocus
                          list="speaker-directory"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => {
                            // Fix 1: Escape sets cancelledRef so the blur triggered by
                            // unmounting the input doesn't also fire a submit
                            if (cancelledRef.current) {
                              cancelledRef.current = false
                              return
                            }
                            void submitRename(label, editValue)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              // Fix 1: mark as cancelled before setEditingLabel so the
                              // ensuing onBlur (from unmount) knows not to submit
                              cancelledRef.current = true
                              setEditingLabel(null)
                            }
                          }}
                          placeholder={displayName}
                          className="w-28 rounded border px-1 text-xs font-medium"
                        />
                      </form>
                    ) : (
                      <button
                        type="button"
                        title="Click to rename speaker"
                        onClick={() => {
                          if (label) {
                            setEditingLabel(label)
                            setEditValue(nameMap[label] ?? "")
                          }
                        }}
                        className="mr-1.5 cursor-pointer text-[12px] font-semibold decoration-dotted underline-offset-2 hover:underline"
                      >
                        {displayName}
                      </button>
                    )}
                    <span className="break-words text-foreground/75">
                      {seg.text}
                    </span>
                  </div>
                </div>
              )
            })}
            {visibleSegments.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No transcript matches.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
