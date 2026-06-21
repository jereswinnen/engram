/**
 * ElevenLabs Scribe transcription provider for Riffado
 * Drop into: src/lib/transcription/providers/elevenlabs.ts
 *
 * Simpler than an async provider: Scribe (batch) is a SINGLE call that returns
 * word-level results with speaker_id — no upload -> create -> poll dance.
 * We group words into speaker-contiguous segments to match Riffado's shape.
 *
 * Two input paths:
 *   - audioData (Blob)        -> multipart upload (local-volume storage)
 *   - cloudStorageUrl (S3/R2) -> pass the URL, no byte transfer through Riffado
 *
 * For very long files, ElevenLabs supports async + webhook (up to 10h). The
 * sync path below is fine for typical meetings.
 *
 * Official SDK alternative:
 *   elevenlabs.speechToText.convert({ file, modelId: "scribe_v2", diarize: true,
 *                                     languageCode, tagAudioEvents })
 * Docs: https://elevenlabs.io/docs/api-reference/speech-to-text
 */

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

export interface ScribeOptions {
  apiKey: string;
  /** "scribe_v2" (default) or "scribe_v1". Batch models — both include diarization. */
  model?: "scribe_v2" | "scribe_v1";
  /**
   * ISO code (e.g. "nld" for Dutch). Leave undefined for auto-detect — often the
   * better choice for Dutch-with-English, since Scribe absorbs embedded English
   * words natively rather than forcing a single language.
   */
  languageCode?: string;
  diarize?: boolean;
  /** Optional hint for expected speaker count. */
  numSpeakers?: number;
  /** Tag (laughter), (music), etc. as audio events. */
  tagAudioEvents?: boolean;
}

/** Riffado's normalized transcript shape (mirrors the existing Whisper path). */
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

interface ScribeWord {
  text: string;
  start?: number;
  end?: number;
  type?: "word" | "spacing" | "audio_event";
  speaker_id?: string;
}
interface ScribeResponse {
  language_code?: string;
  language_probability?: number;
  text: string;
  words?: ScribeWord[];
}

// Group consecutive words sharing a speaker_id into utterance-level segments.
function wordsToSegments(words: ScribeWord[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let cur: TranscriptSegment | null = null;

  for (const w of words) {
    if (w.type === "audio_event") continue; // drop (laughter) etc. — keep if you prefer
    const speaker = w.speaker_id;
    if (!cur || cur.speaker !== speaker) {
      if (cur) segments.push(cur);
      cur = { start: w.start ?? 0, end: w.end ?? 0, text: w.text, speaker };
    } else {
      cur.text += w.text;          // "spacing" tokens carry their own whitespace
      cur.end = w.end ?? cur.end;
    }
  }
  if (cur) segments.push(cur);
  return segments.map((s) => ({ ...s, text: s.text.trim() }));
}

// ---- Public entry point: wire into Riffado's provider selector ----
export async function transcribeWithScribe(
  input: { audioData?: Blob; filename?: string; cloudStorageUrl?: string },
  options: ScribeOptions,
): Promise<TranscriptResult> {
  const form = new FormData();
  form.append("model_id", options.model ?? "scribe_v2");
  form.append("diarize", String(options.diarize ?? true));
  if (options.languageCode) form.append("language_code", options.languageCode);
  if (options.numSpeakers) form.append("num_speakers", String(options.numSpeakers));
  if (options.tagAudioEvents) form.append("tag_audio_events", "true");

  // Prefer a cloud URL (S3/R2 presigned) to avoid moving bytes through Riffado.
  if (input.cloudStorageUrl) {
    form.append("cloud_storage_url", input.cloudStorageUrl);
  } else if (input.audioData) {
    form.append("file", input.audioData, input.filename ?? "audio.mp3");
  } else {
    throw new Error("Provide audioData or cloudStorageUrl");
  }

  const res = await fetch(`${ELEVENLABS_BASE}/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": options.apiKey }, // do NOT set Content-Type; fetch sets the multipart boundary
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Scribe failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as ScribeResponse;
  return {
    text: json.text,
    language: json.language_code,
    segments: json.words ? wordsToSegments(json.words) : [],
    raw: json,
  };
}

/* ---------------------------------------------------------------------------
WIRING NOTES

1. Provider switch — in src/lib/transcription, add a "scribe" branch that calls
   transcribeWithScribe() and persists result.segments like the Whisper path.
   The `speaker` field is the only new column you may want on `transcriptions`.

2. Credentials — store ELEVENLABS_API_KEY via Riffado's api_credentials store
   (AES-256-GCM). Single-user self-host: a plain env var is fine.

3. Audio source — if storage = S3/R2, pass a presigned GET as cloudStorageUrl
   (no byte transfer). If storage = local volume, read the file and pass it as
   audioData (Blob).

4. Language — leave languageCode unset for auto-detect (best for NL + occasional
   EN), or set "nld" to force Dutch. No explicit code-switching config exists;
   Scribe's multilingual model handles embedded English natively.

5. Long files — for recordings near the sync limit, switch to the async +
   webhook variant; the sync call above covers normal meeting lengths.

6. Downstream — segments carry speaker labels, so summary / Ask-AI prompts can
   attribute action items per speaker for free.
--------------------------------------------------------------------------- */
