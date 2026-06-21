export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

export interface TranscriptResult {
  text: string;
  language?: string;
  segments: TranscriptSegment[];
  raw?: unknown;
}
