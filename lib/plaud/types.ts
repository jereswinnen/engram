export interface PlaudRecording {
  fileId: string;
  name: string;
  startAt: string;   // ISO 8601
  startAtMs: number; // epoch ms — checkpoint comparison key
  durationMs?: number;
  trashed: boolean;
}

export interface PlaudRecordingDetail extends PlaudRecording {
  audioUrl: string; // signed, ~24h
}

// Tolerant mapping: Plaud's raw field names are confirmed against web.plaud.ai
// during the live-verify step; we read the most likely keys with fallbacks so
// the shape is resilient and finalizing it is a one-file change.
export function mapRecording(raw: any): PlaudRecording {
  const startRaw = raw.start_at ?? raw.start_time ?? raw.created_at;
  const startAtMs = typeof startRaw === "number" ? startRaw : Date.parse(startRaw);
  if (Number.isNaN(startAtMs)) {
    throw new Error(`mapRecording: no recognizable date field in ${JSON.stringify(raw)}`);
  }
  return {
    fileId: String(raw.id ?? raw.file_id),
    name: raw.name ?? raw.title ?? "Untitled",
    startAt: new Date(startAtMs).toISOString(),
    startAtMs,
    durationMs: typeof raw.duration === "number" ? raw.duration : undefined,
    trashed: Boolean(raw.is_trash ?? raw.trashed ?? raw.is_deleted ?? false),
  };
}

export function mapRecordingDetail(raw: any): PlaudRecordingDetail {
  const audioUrl = raw.presigned_url ?? raw.url ?? raw.audio_url;
  if (!audioUrl) {
    throw new Error(`mapRecordingDetail: no audio URL field in ${JSON.stringify(raw)}`);
  }
  return { ...mapRecording(raw), audioUrl };
}
