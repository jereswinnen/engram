import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { getStorage, buildAudioKey } from "@/lib/storage";
import { runTranscription, runEnhancement } from "@/lib/pipeline";
import { auth } from "@/auth";

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db.query.recordings.findMany();
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });
  const title = (form.get("title") as string | null) ?? file.name;

  const [rec] = await db
    .insert(recordings)
    .values({
      title,
      source: "upload",
      storageKey: "pending",
      contentType: file.type || "application/octet-stream",
    })
    .returning();

  const key = buildAudioKey(rec.id, file.name);
  await getStorage().put(key, Buffer.from(await file.arrayBuffer()), rec.contentType);
  await db.update(recordings).set({ storageKey: key }).where(eq(recordings.id, rec.id));

  // fire-and-forget the pipeline (Phase 0: route stays warm long enough on Railway)
  runTranscription(rec.id)
    .then(() => runEnhancement(rec.id))
    .catch(() => {});

  return NextResponse.json({ id: rec.id }, { status: 201 });
}
