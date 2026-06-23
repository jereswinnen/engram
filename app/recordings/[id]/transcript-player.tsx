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
