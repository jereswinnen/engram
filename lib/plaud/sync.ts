import { eq } from "drizzle-orm";
import { db } from "@/db";
import { recordings, syncState } from "@/db/schema";
import { getStorage, buildAudioKey } from "@/lib/storage";
import { runTranscription, runEnhancement } from "@/lib/pipeline";
import { getPlaudToken } from "./credentials";
import { listRecordings, getRecordingDetail, downloadAudio, PlaudAuthError } from "./client";
import type { PlaudRecording } from "./types";

export interface SyncResult {
  ranAt: string;
  newCount: number;
  skippedCount: number;
  failedCount: number;
  error?: string;
}

export function selectNewRecordings(
  all: PlaudRecording[],
  checkpointMs: number,
  existingFileIds: Set<string>,
): PlaudRecording[] {
  return all
    .filter((r) => !r.trashed)
    .filter((r) => r.startAtMs > checkpointMs)
    .filter((r) => !existingFileIds.has(r.fileId))
    .sort((a, b) => a.startAtMs - b.startAtMs);
}

function extFromContentType(ct: string): string {
  if (ct.includes("mp4") || ct.includes("m4a") || ct.includes("aac")) return "m4a";
  if (ct.includes("wav")) return "wav";
  if (ct.includes("ogg") || ct.includes("opus")) return "ogg";
  return "mp3";
}

async function getSyncRow() {
  let row = await db.query.syncState.findFirst();
  if (!row) {
    [row] = await db.insert(syncState).values({}).returning();
  }
  return row;
}

export async function syncPlaud(): Promise<SyncResult> {
  const ranAt = new Date().toISOString();
  const base: SyncResult = { ranAt, newCount: 0, skippedCount: 0, failedCount: 0 };

  const row = await getSyncRow();

  const token = await getPlaudToken();
  if (!token) {
    const result = { ...base, error: "not connected — paste a Plaud token in Settings" };
    await writeResult(row.id, result);
    return result;
  }

  const checkpointMs = row.lastSyncedAt ? new Date(row.lastSyncedAt).getTime() : 0;

  let all: PlaudRecording[];
  try {
    all = await listRecordings(token);
  } catch (e) {
    const error = e instanceof PlaudAuthError ? "reconnect needed — Plaud token rejected" : (e as Error).message;
    const result = { ...base, error };
    await writeResult(row.id, result); // NOTE: checkpoint not advanced
    return result;
  }

  const existing = await db.query.recordings.findMany();
  const existingFileIds = new Set(existing.map((r: any) => r.plaudFileId).filter(Boolean) as string[]);

  const candidates = selectNewRecordings(all, checkpointMs, existingFileIds);
  const skippedCount = all.length - candidates.length;

  let newCount = 0;
  let failedCount = 0;
  let maxSuccessMs = checkpointMs;
  let earliestFailureMs = Infinity;

  for (const r of candidates) {
    try {
      const detail = await getRecordingDetail(token, r.fileId);
      const { bytes, contentType } = await downloadAudio(detail.audioUrl);
      const [rec] = await db
        .insert(recordings)
        .values({
          title: r.name,
          source: "plaud",
          storageKey: "pending",
          contentType,
          durationSeconds: r.durationMs ? Math.round(r.durationMs / 1000) : null,
          plaudFileId: r.fileId,
        })
        .returning();
      const key = buildAudioKey(rec.id, `x.${extFromContentType(contentType)}`);
      await getStorage().put(key, bytes, contentType);
      await db.update(recordings).set({ storageKey: key }).where(eq(recordings.id, rec.id));

      await runTranscription(rec.id);
      const stored = await db.query.recordings.findFirst({ where: eq(recordings.id, rec.id) });
      if (stored?.status === "transcribed") await runEnhancement(rec.id);

      newCount++;
      if (r.startAtMs > maxSuccessMs) maxSuccessMs = r.startAtMs;
    } catch {
      failedCount++;
      earliestFailureMs = Math.min(earliestFailureMs, r.startAtMs);
    }
  }

  const newCheckpointMs =
    earliestFailureMs === Infinity
      ? maxSuccessMs
      : Math.max(checkpointMs, earliestFailureMs - 1);

  const result: SyncResult = { ranAt, newCount, skippedCount, failedCount };
  // advance checkpoint only after the batch completes
  await db.update(syncState).set({ lastSyncedAt: new Date(newCheckpointMs), lastResult: result }).where(eq(syncState.id, row.id));
  return result;
}

async function writeResult(rowId: string, result: SyncResult) {
  await db.update(syncState).set({ lastResult: result }).where(eq(syncState.id, rowId));
}
