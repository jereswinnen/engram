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
  deferredCount: number; // audio not downloadable from Plaud yet — retried next sync
  processingErrorCount: number; // imported, but transcription/enhancement failed (status "error")
  note?: string; // set only when a run is skipped (e.g. already running)
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
    // Newest-first: a slow or interrupted run must import the latest recordings
    // before grinding through an older backlog, otherwise fresh recordings sit at
    // the back of the queue and never get reached. The end-of-run checkpoint math
    // is order-independent (min/max over outcomes), so processing order is free.
    .sort((a, b) => b.startAtMs - a.startAtMs);
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
  const base: SyncResult = { ranAt, newCount: 0, skippedCount: 0, failedCount: 0, deferredCount: 0, processingErrorCount: 0 };

  const row = await getSyncRow();

  // Concurrency guard: don't let a scheduled run overlap a manual/previous one
  // (which would double-import + double-pay). A live run heartbeats `runningSince`
  // before every item (see loop below), so a lock older than the stale window means
  // the owner crashed/was killed mid-run — we take over instead of waiting the full
  // hour+ a long run could occupy. The window must comfortably exceed the slowest
  // single item (download + transcribe + enhance).
  const STALE_LOCK_MS = 10 * 60 * 1000;
  if (row.runningSince && Date.now() - new Date(row.runningSince).getTime() < STALE_LOCK_MS) {
    // Record the skip so the UI's "last sync" reflects that an attempt happened
    // (the run that owns the lock will overwrite this with its real result when it finishes).
    const result = { ...base, note: "skipped — a sync is already running" };
    await writeResult(row.id, result);
    return result;
  }
  await db.update(syncState).set({ runningSince: new Date() }).where(eq(syncState.id, row.id));

  try {
    if (!(await isConnected())) {
      const result = { ...base, error: "not connected — connect Plaud in Settings" };
      await writeResult(row.id, result);
      return result;
    }

    const checkpointMs = row.lastSyncedAt ? new Date(row.lastSyncedAt).getTime() : 0;

    let client: Awaited<ReturnType<typeof connect>>;
    try {
      client = await connect();
    } catch (e) {
      console.error("[plaud sync] connect failed", e);
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
      console.error("[plaud sync] list_files failed", e);
      const result = { ...base, error: (e as Error).message };
      await writeResult(row.id, result); // checkpoint not advanced
      return result;
    }

    const existing = await db.query.recordings.findMany();
    const existingFileIds = new Set(existing.map((r: any) => r.plaudFileId).filter(Boolean) as string[]);

    const candidates = selectNewRecordings(all, checkpointMs, existingFileIds);
    const skippedCount = all.length - candidates.length;
    console.info(
      `[plaud sync] start: ${all.length} listed, ${existingFileIds.size} already imported, ` +
        `${candidates.length} to process, checkpoint=${checkpointMs ? new Date(checkpointMs).toISOString() : "none"}`,
    );

    let newCount = 0;
    let failedCount = 0;
    let deferredCount = 0;
    let processingErrorCount = 0;
    let maxSuccessMs = checkpointMs;
    let earliestFailureMs = Infinity;
    let earliestDeferredMs = Infinity;
    let earliestUnprocessedMs = Infinity; // left for next run because the time budget ran out
    let firstItemError: string | undefined;

    // Process one candidate end-to-end: download → store → transcribe → enhance.
    // Mutates the shared counters above; safe under the worker pool because each
    // statement runs to completion on JS's single thread (no torn updates).
    async function processOne(r: PlaudFile) {
      let insertedId: string | undefined;
      try {
        const detail = await getFile(client, r.fileId);
        if (!detail.presignedUrl) {
          // Plaud has the recording but the audio isn't downloadable yet (still
          // processing). Defer: don't import, don't count as a failure — leave the
          // checkpoint before it so the next sync retries once the audio is ready.
          deferredCount++;
          earliestDeferredMs = Math.min(earliestDeferredMs, r.startAtMs);
          console.info("[plaud sync] deferring (audio not ready)", r.fileId);
          return;
        }
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
        let stored = await db.query.recordings.findFirst({ where: eq(recordings.id, rec.id) });
        if (stored?.status === "transcribed") {
          await runEnhancement(rec.id);
          stored = await db.query.recordings.findFirst({ where: eq(recordings.id, rec.id) });
        }
        // The pipeline swallows its own errors and parks the recording in "error" status
        // rather than throwing. Surface that here so a failed transcription/enhancement is
        // visible in the sync result instead of silently counting as a clean import. We do
        // NOT treat it as a checkpoint blocker: the recording is already imported (deduped
        // next run), so re-listing it would never reprocess it — it needs a per-recording
        // retry, not a re-sync.
        if (stored?.status === "error") {
          processingErrorCount++;
          const msg = stored.errorMessage ?? "transcription/enhancement failed";
          if (firstItemError === undefined) firstItemError = msg;
          console.warn("[plaud sync] processing error", r.fileId, msg);
        }

        newCount++;
        if (r.startAtMs > maxSuccessMs) maxSuccessMs = r.startAtMs;
      } catch (e) {
        failedCount++;
        earliestFailureMs = Math.min(earliestFailureMs, r.startAtMs);
        const msg = e instanceof Error ? e.message : String(e);
        if (firstItemError === undefined) firstItemError = msg;
        console.error("[plaud sync] item failed", r.fileId, msg);
        if (insertedId) {
          try { await db.delete(recordings).where(eq(recordings.id, insertedId)); } catch {}
        }
      }
    }

    // Drain the queue with a bounded worker pool so a backlog finishes in minutes
    // instead of serializing into an hour-plus run that gets killed before it can
    // write its checkpoint. A wall-clock budget stops starting new items well before
    // any platform kill window; whatever's left — the oldest items, since we go
    // newest-first — is recorded as a blocker so the checkpoint stays before it and
    // the next run resumes there. Tune via PLAUD_SYNC_CONCURRENCY / PLAUD_SYNC_BUDGET_MS
    // (lower the concurrency if Plaud/transcription rate-limits).
    const CONCURRENCY = Math.max(1, Number(process.env.PLAUD_SYNC_CONCURRENCY) || 5);
    const BUDGET_MS = Number(process.env.PLAUD_SYNC_BUDGET_MS) || 25 * 60 * 1000;
    const startedAt = Date.now();
    let cursor = 0;
    const worker = async () => {
      while (cursor < candidates.length) {
        const r = candidates[cursor++];
        if (Date.now() - startedAt > BUDGET_MS) {
          earliestUnprocessedMs = Math.min(earliestUnprocessedMs, r.startAtMs);
          continue; // out of time — leave it (and the rest) for the next run
        }
        // Heartbeat the lock so a live run isn't mistaken for a crashed one, and a
        // crash leaves a lock only as stale as the last item (recovered within STALE_LOCK_MS).
        await db.update(syncState).set({ runningSince: new Date() }).where(eq(syncState.id, row.id));
        await processOne(r);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    if (earliestUnprocessedMs !== Infinity) {
      const left = candidates.length - newCount - failedCount - deferredCount;
      console.warn(`[plaud sync] time budget (${Math.round(BUDGET_MS / 60000)}m) hit — ${left} item(s) deferred to next run`);
    }

    // Don't advance the checkpoint past the earliest blocker (a real failure, a
    // deferred audio-not-ready item, or an item left unprocessed by the time budget),
    // so each is retried on the next sync.
    const earliestBlockerMs = Math.min(earliestFailureMs, earliestDeferredMs, earliestUnprocessedMs);
    const newCheckpointMs =
      earliestBlockerMs === Infinity ? maxSuccessMs : Math.max(checkpointMs, earliestBlockerMs - 1);
    const result: SyncResult = {
      ranAt, newCount, skippedCount, failedCount, deferredCount, processingErrorCount,
      // Only a genuine import failure is a top-level error (it blocks the checkpoint and reds
      // the cron). Deferred items and processing errors are normal/recoverable — surfaced via
      // their counts, not as an error.
      ...(failedCount > 0 && firstItemError ? { error: `first failure: ${firstItemError}` } : {}),
    };
    await db.update(syncState).set({ lastSyncedAt: new Date(newCheckpointMs), lastResult: result }).where(eq(syncState.id, row.id));
    console.info(
      `[plaud sync] done: ${newCount} new, ${failedCount} failed, ${deferredCount} deferred, ` +
        `${processingErrorCount} processing errors; checkpoint ${checkpointMs === newCheckpointMs ? "held" : "advanced"} ` +
        `to ${new Date(newCheckpointMs).toISOString()}`,
    );
    return result;
    } finally {
      await client.close();
    }
  } finally {
    await db.update(syncState).set({ runningSince: null }).where(eq(syncState.id, row.id));
  }
}

async function writeResult(rowId: string, result: SyncResult) {
  await db.update(syncState).set({ lastResult: result }).where(eq(syncState.id, rowId));
}
