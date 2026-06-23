function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Prettify a raw speaker label for display.
 * - "speaker_0" / "speaker-0" / "speaker0" → "Speaker 1" (zero-based → 1-based)
 * - Already "Speaker N" / "Speaker ?" → unchanged
 * - Anything else (e.g. "A") → "Speaker A"
 */
export function formatLabel(label: string): string {
  // Already speaker-prefixed (e.g. "Speaker 2", "Speaker ?") — pass through unchanged.
  // Note: "speaker_0" has no \b after "speaker" (underscore is \w), so it falls through.
  if (/^speaker\b/i.test(label)) return label;
  // Raw Scribe label: "speaker_N", "speaker-N", "speaker N", "speakerN" → 1-based
  const m = label.match(/^speaker[_\s-]?(\d+)$/i);
  if (m) return `Speaker ${Number(m[1]) + 1}`;
  // Anything else
  return `Speaker ${label}`;
}

export function nameForLabel(label: string, map: Record<string, string>): string {
  return map[label] ?? formatLabel(label);
}

export function buildNamedTranscript(
  segments: { start: number; text: string; speaker?: string | null }[],
  map: Record<string, string>,
): string {
  return segments
    .map((s) => `[${mmss(s.start)}] ${nameForLabel(s.speaker ?? "Speaker ?", map)}: ${s.text}`)
    .join("\n");
}
