"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import WaveSurfer from "wavesurfer.js"
import {
  RiForward15Line,
  RiPauseFill,
  RiPlayFill,
  RiReplay15Line,
  RiSearchLine,
} from "@remixicon/react"
import { activeSegmentIndex } from "@/lib/transcript/active-segment"
import { firstMatchingSegmentIndex } from "@/lib/search/match"
import { nameForLabel } from "@/lib/transcript/speaker-names"

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
  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const segmentRefs = useRef<Array<HTMLButtonElement | null>>([])
  const segmentsRef = useRef(segments)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
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

  // Init Wavesurfer once. `audioSrc` is stable for the page's lifetime.
  // Decouple from segments to avoid re-initialization on prop identity change.
  useEffect(() => {
    if (!containerRef.current) return
    const media = document.createElement("audio")
    media.src = audioSrc // streaming playback via the MediaElement path
    media.preload = "metadata"

    const ws = WaveSurfer.create({
      container: containerRef.current,
      media, // v7: use this media element (streams; no full pre-decode for playback)
      height: 42,
      waveColor: "#dbe3e8",
      progressColor: "#1976b9",
      cursorColor: "#1976b9",
      barWidth: 2,
      barGap: 1.5,
      barRadius: 2,
    })
    wsRef.current = ws

    const onTime = (t: number) => {
      setCurrentTime(t)
      setActive(activeSegmentIndex(segmentsRef.current, t))
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
  }, [audioSrc, highlightQuery, initialTime])

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
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={() => wsRef.current?.playPause()}
          aria-label={playing ? "Pause" : "Play"}
          className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/85"
        >
          {playing ? (
            <RiPauseFill className="size-4" />
          ) : (
            <RiPlayFill className="ml-0.5 size-4" />
          )}
        </button>
        <button
          type="button"
          onClick={() => seekBy(-15)}
          aria-label="Back 15 seconds"
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <RiReplay15Line className="size-4" />
        </button>
        <button
          type="button"
          onClick={cyclePlaybackRate}
          aria-label={`Playback speed ${playbackRate}x`}
          className="h-8 shrink-0 rounded-lg px-1.5 text-xs font-medium tabular-nums hover:bg-muted"
        >
          {playbackRate}x
        </button>
        <button
          type="button"
          onClick={() => seekBy(15)}
          aria-label="Forward 15 seconds"
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <RiForward15Line className="size-4" />
        </button>

        <div className="min-w-20 flex-1" ref={containerRef} />
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>

      {error && <p className="text-sm text-destructive">Audio unavailable.</p>}

      {chapters && chapters.length > 0 && (
        <details className="rounded-lg border px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">
            Chapters · {chapters.length}
          </summary>
          <div className="mt-2 flex flex-col gap-1 border-t pt-2">
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
                    if (seekable) wsRef.current?.setTime(chapter.startSeconds!)
                  }}
                  className="rounded-md px-1.5 py-1 text-left hover:bg-muted disabled:opacity-60"
                >
                  {chapter.startSeconds != null && (
                    <span className="mr-1.5 text-xs text-muted-foreground tabular-nums">
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

      {segments.length > 0 && (
        <>
          {directory.length > 0 && (
            <datalist id="speaker-directory">
              {directory.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          )}
          <div className="relative">
            <RiSearchLine className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={transcriptSearch}
              onChange={(event) => setTranscriptSearch(event.target.value)}
              placeholder="Search transcript"
              aria-label="Search transcript"
              className="h-9 w-full rounded-lg border bg-background pr-3 pl-9 text-sm transition-colors outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
          </div>
          <div className="flex max-h-[min(700px,calc(100vh-320px))] min-h-80 flex-col overflow-y-auto pr-1 text-sm">
            {visibleSegments.map(({ segment: seg, index: i }) => {
              const label = seg.speaker ?? ""
              const displayName = nameForLabel(label || "Speaker ?", nameMap)
              const isEditing = editingLabel === label && label !== ""
              return (
                <div
                  key={i}
                  className={`grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 rounded-lg px-2 py-2 ${i === active ? "bg-primary/8" : "hover:bg-muted/45"}`}
                >
                  <button
                    type="button"
                    ref={(el) => {
                      segmentRefs.current[i] = el
                    }}
                    onClick={() => wsRef.current?.setTime(seg.start)}
                    className="cursor-pointer self-start text-left"
                  >
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatTime(seg.start)}
                    </span>
                  </button>
                  <div className="min-w-0 leading-5">
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
                        className="mr-1.5 cursor-pointer font-medium decoration-dotted hover:underline"
                      >
                        {displayName}
                      </button>
                    )}
                    <span className="break-words text-foreground/85">
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
