import type { Readable } from "node:stream"

export interface Storage {
  put(
    key: string,
    body: Buffer | Uint8Array,
    contentType: string
  ): Promise<void>
  putStream(key: string, body: Readable, contentType: string): Promise<void>
  presignedPutUrl(
    key: string,
    contentType: string,
    ttlSeconds?: number
  ): Promise<string>
  presignedGetUrl(key: string, ttlSeconds?: number): Promise<string>
  head(key: string): Promise<{ size: number; contentType?: string } | null>
  delete(key: string): Promise<void>
}

export function buildAudioKey(recordingId: string, filename: string): string {
  const ext = filename.includes(".") ? filename.split(".").pop() : "bin"
  return `audio/${recordingId}.${ext}`
}
