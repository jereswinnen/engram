import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { recordings, transcriptions, aiEnhancements } from "@/db/schema";
import { recordingToMarkdown } from "@/lib/export/markdown";
import { recordingToExport } from "@/lib/export/json";
import { exportFilename } from "@/lib/export/filename";
import { getRecordingSpeakerMap } from "@/lib/speakers/store";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const format = request.nextUrl.searchParams.get("format");
  if (format !== "md" && format !== "json") {
    return NextResponse.json({ error: "format must be md or json" }, { status: 400 });
  }

  const rec = await db.query.recordings.findFirst({ where: eq(recordings.id, id) });
  if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [tr, enh, speakerMap] = await Promise.all([
    db.query.transcriptions.findFirst({
      where: eq(transcriptions.recordingId, id),
      orderBy: [desc(transcriptions.createdAt)],
    }),
    db.query.aiEnhancements.findFirst({
      where: eq(aiEnhancements.recordingId, id),
      orderBy: [desc(aiEnhancements.createdAt)],
    }),
    getRecordingSpeakerMap(id),
  ]);

  const body =
    format === "md"
      ? recordingToMarkdown(rec, tr ?? null, enh ?? null, speakerMap)
      : JSON.stringify(recordingToExport(rec, tr ?? null, enh ?? null, speakerMap), null, 2);

  const filename = exportFilename(rec.title, rec.id, format);
  const contentType =
    format === "md" ? "text/markdown; charset=utf-8" : "application/json; charset=utf-8";

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
