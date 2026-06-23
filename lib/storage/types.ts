import type { Readable } from "node:stream";

export interface Storage {
  put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void>;
  putStream(key: string, body: Readable, contentType: string): Promise<void>;
  presignedGetUrl(key: string, ttlSeconds?: number): Promise<string>;
  delete(key: string): Promise<void>;
}

export function buildAudioKey(recordingId: string, filename: string): string {
  const ext = filename.includes(".") ? filename.split(".").pop() : "bin";
  return `audio/${recordingId}.${ext}`;
}
