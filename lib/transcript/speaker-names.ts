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
