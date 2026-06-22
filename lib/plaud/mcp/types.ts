export interface PlaudFile {
  fileId: string;
  name: string;
  startAtMs: number; // epoch ms — checkpoint key
  durationMs?: number;
  trashed: boolean;
}

export interface PlaudFileDetail extends PlaudFile {
  presignedUrl: string; // signed, ~24h
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
  const presignedUrl = raw.presigned_url ?? raw.url ?? raw.audio_url;
  if (!presignedUrl) throw new Error(`mapFileDetail: no presigned_url in ${JSON.stringify(raw)}`);
  return { ...mapFile(raw), presignedUrl };
}
