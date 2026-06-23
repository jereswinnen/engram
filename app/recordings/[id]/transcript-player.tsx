"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import WaveSurfer from "wavesurfer.js";
import { activeSegmentIndex } from "@/lib/transcript/active-segment";
import { firstMatchingSegmentIndex } from "@/lib/search/match";
import { nameForLabel } from "@/lib/transcript/speaker-names";

type Segment = { start: number; end: number; text: string; speaker?: string | null };

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type Chapter = { title: string; gist: string; startSeconds?: number };

export function TranscriptPlayer({
  audioSrc,
  segments,
  highlightQuery,
  chapters,
  speakerMap = {},
  directory = [],
  recordingId = "",
}: {
  audioSrc: string;
  segments: Segment[];
  highlightQuery?: string;
  chapters?: Chapter[];
  speakerMap?: Record<string, string>;
  directory?: string[];
  recordingId?: string;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const segmentRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const segmentsRef = useRef(segments);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState(false);
  const [nameMap, setNameMap] = useState<Record<string, string>>(speakerMap);
  // editingLabel: the diarized label currently being renamed (e.g. "SPEAKER_00")
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  // Sync segmentsRef with the latest segments prop.
  useEffect(() => {
    segmentsRef.current = segments;
  });

  // Init Wavesurfer once. `audioSrc` is stable for the page's lifetime.
  // Decouple from segments to avoid re-initialization on prop identity change.
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
      setActive(activeSegmentIndex(segmentsRef.current, t));
    };
    ws.on("timeupdate", onTime);
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
    ws.on("play", () => setPlaying(true));
    ws.on("pause", () => setPlaying(false));
    ws.on("error", () => setError(true));

    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  }, [audioSrc]);

  // Auto-scroll the active segment into view as it changes.
  useEffect(() => {
    if (active >= 0) {
      segmentRefs.current[active]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [active]);

  async function submitRename(label: string, name: string) {
    setEditingLabel(null);
    const trimmed = name.trim();
    await fetch(`/api/recordings/${recordingId}/speakers`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, name: trimmed }),
    });
    if (trimmed) {
      setNameMap((m) => ({ ...m, [label]: trimmed }));
    } else {
      setNameMap((m) => {
        const next = { ...m };
        delete next[label];
        return next;
      });
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => wsRef.current?.playPause()}
          aria-label={playing ? "Pause" : "Play"}
          className="rounded-md border px-3 py-1 text-sm hover:bg-muted"
        >
          {playing ? "Pause" : "Play"}
        </button>
        <span className="text-xs text-muted-foreground tabular-nums">{formatTime(currentTime)} / {formatTime(duration)}</span>
      </div>

      <div ref={containerRef} className="w-full" />
      {error && <p className="text-sm text-destructive">Audio unavailable.</p>}

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

      {segments.length > 0 && (
        <>
          {directory.length > 0 && (
            <datalist id="speaker-directory">
              {directory.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          )}
          <div className="mt-2 flex max-h-96 flex-col gap-1 overflow-y-auto text-sm font-mono">
            {segments.map((seg, i) => {
              const label = seg.speaker ?? "";
              const displayName = nameForLabel(label || "Speaker ?", nameMap);
              const isEditing = editingLabel === label && label !== "";
              return (
                <div
                  key={i}
                  className={`flex items-baseline gap-1 rounded px-1 ${i === active ? "bg-muted" : ""}`}
                >
                  <button
                    type="button"
                    ref={(el) => {
                      segmentRefs.current[i] = el;
                    }}
                    onClick={() => wsRef.current?.setTime(seg.start)}
                    className="cursor-pointer text-left shrink-0"
                  >
                    <span className="text-muted-foreground text-xs">{formatTime(seg.start)}</span>
                  </button>
                  {" "}
                  {isEditing ? (
                    <form
                      className="inline-flex items-center gap-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void submitRename(label, editValue);
                      }}
                    >
                      <input
                        autoFocus
                        list="speaker-directory"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => void submitRename(label, editValue)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setEditingLabel(null);
                        }}
                        placeholder={displayName}
                        className="rounded border px-1 text-xs font-medium w-28"
                      />
                    </form>
                  ) : (
                    <button
                      type="button"
                      title="Click to rename speaker"
                      onClick={() => {
                        if (label) {
                          setEditingLabel(label);
                          setEditValue(nameMap[label] ?? "");
                        }
                      }}
                      className="font-medium hover:underline decoration-dotted cursor-pointer shrink-0"
                    >
                      {displayName}
                    </button>
                  )}
                  {": "}
                  <span className="break-words">{seg.text}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
