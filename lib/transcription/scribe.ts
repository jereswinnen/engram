import { config } from "@/lib/config";
import { TranscriptResult, TranscriptSegment } from "./types";

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

export interface ScribeOptions {
  apiKey?: string;
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
  /** Bias transcription toward these terms (Scribe `keyterms`). Sent only when non-empty. */
  keyterms?: string[];
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

/**
 * Group consecutive words sharing a speaker_id into utterance-level segments.
 * Drops audio_event tokens (laughter, music, etc.).
 */
export function wordsToSegments(words: ScribeWord[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let cur: TranscriptSegment | null = null;

  for (const w of words) {
    if (w.type === "audio_event") continue; // drop (laughter) etc.
    const speaker = w.speaker_id;
    if (!cur || cur.speaker !== speaker) {
      if (cur) segments.push(cur);
      cur = { start: w.start ?? 0, end: w.end ?? 0, text: w.text, speaker };
    } else {
      cur.text += w.text; // "spacing" tokens carry their own whitespace
      cur.end = w.end ?? cur.end;
    }
  }
  if (cur) segments.push(cur);
  return segments.map((s) => ({ ...s, text: s.text.trim() }));
}

/**
 * Transcribe audio using ElevenLabs Scribe API.
 * Supports both cloud storage URLs (presigned R2/S3 GET) and local Blob uploads.
 * Defaults to auto-detect language and diarization enabled.
 */
export async function transcribeWithScribe(
  input: { audioData?: Blob; filename?: string; cloudStorageUrl?: string },
  options: ScribeOptions = {},
): Promise<TranscriptResult> {
  const apiKey = options.apiKey ?? config.elevenLabsApiKey();

  const form = new FormData();
  form.append("model_id", options.model ?? "scribe_v2");
  form.append("diarize", String(options.diarize ?? true));
  if (options.languageCode) form.append("language_code", options.languageCode);
  if (options.numSpeakers) form.append("num_speakers", String(options.numSpeakers));
  if (options.tagAudioEvents) form.append("tag_audio_events", "true");
  if (options.keyterms && options.keyterms.length > 0) {
    form.append("keyterms", JSON.stringify(options.keyterms));
  }

  // Prefer a cloud URL (S3/R2 presigned) to avoid moving bytes through the app.
  if (input.cloudStorageUrl) {
    form.append("cloud_storage_url", input.cloudStorageUrl);
  } else if (input.audioData) {
    form.append("file", input.audioData, input.filename ?? "audio.mp3");
  } else {
    throw new Error("Provide audioData or cloudStorageUrl");
  }

  const res = await fetch(`${ELEVENLABS_BASE}/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": apiKey }, // do NOT set Content-Type; fetch sets the multipart boundary
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
