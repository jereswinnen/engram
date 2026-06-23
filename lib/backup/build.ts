import { Readable, PassThrough } from "node:stream";
import { ZipArchive } from "archiver";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { recordings, transcriptions, aiEnhancements } from "@/db/schema";
import { getStorage } from "@/lib/storage";
import { recordingToMarkdown } from "@/lib/export/markdown";
import { recordingToExport } from "@/lib/export/json";
import { exportFilename } from "@/lib/export/filename";
import { markReady, markError } from "./store";

export async function buildBackup(id: string): Promise<void> {
  try {
    const recs = await db.query.recordings.findMany();
    const storage = getStorage();

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on("error", (err) => {
      void markError(id, err instanceof Error ? err.message : String(err));
    });
    const counter = new PassThrough();
    let size = 0;
    counter.on("data", (chunk: Buffer) => { size += chunk.length; });
    archive.pipe(counter);

    const key = `backups/${id}.zip`;
    // putStream consumes the counter stream; run concurrently with appends.
    const upload = storage.putStream(key, counter, "application/zip");

    const manifest = { createdAt: new Date().toISOString(), recordings: [] as any[], errors: [] as any[] };

    for (const rec of recs) {
      const tr = await db.query.transcriptions.findFirst({ where: eq(transcriptions.recordingId, rec.id), orderBy: [desc(transcriptions.createdAt)] });
      const enh = await db.query.aiEnhancements.findFirst({ where: eq(aiEnhancements.recordingId, rec.id), orderBy: [desc(aiEnhancements.createdAt)] });
      const folder = `recordings/${rec.id}`;
      archive.append(recordingToMarkdown(rec, tr ?? null, enh ?? null), { name: `${folder}/transcript.md` });
      archive.append(JSON.stringify(recordingToExport(rec, tr ?? null, enh ?? null), null, 2), { name: `${folder}/data.json` });
      try {
        const url = await storage.presignedGetUrl(rec.storageKey, 3600);
        const res = await fetch(url);
        if (!res.ok || !res.body) throw new Error(`audio ${res.status}`);
        archive.append(Readable.fromWeb(res.body as any), { name: `${folder}/${exportFilename(rec.title, rec.id, audioExt(rec.contentType))}` });
        manifest.recordings.push({ id: rec.id, title: rec.title, audio: true });
      } catch (e) {
        manifest.errors.push({ recordingId: rec.id, error: e instanceof Error ? e.message : String(e) });
        manifest.recordings.push({ id: rec.id, title: rec.title, audio: false });
      }
    }

    archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
    await archive.finalize();
    await upload;
    await markReady(id, key, size);
  } catch (e) {
    await markError(id, e instanceof Error ? e.message : String(e));
  }
}

function audioExt(contentType: string | null | undefined): string {
  if (!contentType) return "mp3";
  if (contentType.includes("mp4") || contentType.includes("m4a") || contentType.includes("aac")) return "m4a";
  if (contentType.includes("wav")) return "wav";
  if (contentType.includes("ogg") || contentType.includes("opus")) return "ogg";
  return "mp3";
}
