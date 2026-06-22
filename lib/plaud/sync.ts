import { eq } from "drizzle-orm";
import { db } from "@/db";
import { recordings, syncState } from "@/db/schema";
import { getStorage, buildAudioKey } from "@/lib/storage";
import { runTranscription, runEnhancement } from "@/lib/pipeline";
import { isConnected, connect, listFiles, getFile, downloadAudio } from "./mcp/client";
import type { PlaudFile } from "./mcp/types";

export interface SyncResult {
  ranAt: string;
  newCount: number;
  skippedCount: number;
  failedCount: number;
  error?: string;
}

export function selectNewRecordings(
  all: PlaudFile[],
  checkpointMs: number,
  existingFileIds: Set<string>,
): PlaudFile[] {
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

  if (!(await isConnected())) {
    const result = { ...base, error: "not connected — connect Plaud in Settings" };
    await writeResult(row.id, result);
    return result;
  }

  const checkpointMs = row.lastSyncedAt ? new Date(row.lastSyncedAt).getTime() : 0;

  let client;
  try {
    client = await connect();
  } catch {
    const result = { ...base, error: "reconnect needed — Plaud authorization expired" };
    await writeResult(row.id, result); // checkpoint not advanced
    return result;
  }

  try {
    let all: PlaudFile[];
    try {
      const dateFrom = row.lastSyncedAt ? new Date(row.lastSyncedAt).toISOString() : undefined;
      all = await listFiles(client, dateFrom ? { date_from: dateFrom } : {});
    } catch (e) {
      const result = { ...base, error: (e as Error).message };
      await writeResult(row.id, result); // checkpoint not advanced
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
      let insertedId: string | undefined;
      try {
        const detail = await getFile(client, r.fileId);
        const { bytes, contentType } = await downloadAudio(detail.presignedUrl);
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
        insertedId = rec.id;
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
        if (insertedId) {
          try { await db.delete(recordings).where(eq(recordings.id, insertedId)); } catch {}
        }
      }
    }

    const newCheckpointMs =
      earliestFailureMs === Infinity ? maxSuccessMs : Math.max(checkpointMs, earliestFailureMs - 1);
    const result: SyncResult = { ranAt, newCount, skippedCount, failedCount };
    await db.update(syncState).set({ lastSyncedAt: new Date(newCheckpointMs), lastResult: result }).where(eq(syncState.id, row.id));
    return result;
  } finally {
    await client.close();
  }
}

async function writeResult(rowId: string, result: SyncResult) {
  await db.update(syncState).set({ lastResult: result }).where(eq(syncState.id, rowId));
}
