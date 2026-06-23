export interface PlaudFile {
  fileId: string;
  name: string;
  startAtMs: number; // epoch ms — checkpoint key
  durationMs?: number;
  trashed: boolean;
}

export interface PlaudFileDetail extends PlaudFile {
  // Signed audio URL (~24h). null when Plaud has the recording/transcript but
  // hasn't finished making the audio downloadable yet (e.g. a fresh recording
  // still processing) — the sync defers these and retries on the next run.
  presignedUrl: string | null;
}

/** MCP tool results are { content: [{ type:"text", text }, …] }. */
export function parseToolJson<T>(result: any): T {
  const text = (result?.content ?? [])
    .filter((b: any) => b?.type === "text")
    .map((b: any) => b.text)
    .join("");
  if (result?.isError) {
    throw new Error(`Plaud MCP tool error: ${text.slice(0, 800)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Plaud MCP returned non-JSON: ${text.slice(0, 800)}`);
  }
}

// Field names confirmed against the MCP docs (id/name/start_at/duration ms/presigned_url);
// tolerant fallbacks + a loud throw so a wrong field is caught at the live step, not silently.
export function mapFile(raw: any): PlaudFile {
  const startRaw = raw.start_at ?? raw.start_time ?? raw.created_at;
  const startAtMs = typeof startRaw === "number" ? startRaw : Date.parse(startRaw);
  if (Number.isNaN(startAtMs)) throw new Error(`mapFile: no recognizable date field in ${JSON.stringify(raw)}`);
  return {
    fileId: String(raw.id ?? raw.file_id),
    name: raw.name ?? raw.title ?? "Untitled",
    startAtMs,
    durationMs: typeof raw.duration === "number" ? raw.duration : undefined,
    trashed: Boolean(raw.is_trash ?? raw.trashed ?? raw.is_deleted ?? false),
  };
}

export function mapFileDetail(raw: any): PlaudFileDetail {
  // null (not a throw) when the audio isn't downloadable yet — the sync defers
  // these so a freshly-recorded file (transcript ready, audio still processing)
  // is retried next run instead of surfacing as a hard failure.
  const presignedUrl = raw.presigned_url ?? raw.url ?? raw.audio_url ?? null;
  return { ...mapFile(raw), presignedUrl };
}
