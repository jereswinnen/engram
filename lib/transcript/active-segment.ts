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
