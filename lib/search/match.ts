export function firstMatchingSegmentIndex(segments: { text: string }[], q: string): number {
  const needle = q.trim().toLowerCase();
  if (!needle) return -1;
  return segments.findIndex((s) => s.text.toLowerCase().includes(needle));
}
