import { NextRequest, NextResponse } from "next/server";
import { runTranscription, runEnhancement } from "@/lib/pipeline";
import { auth } from "@/auth";
import { db } from "@/db";
import { eq } from "drizzle-orm";
import { recordings } from "@/db/schema";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  // Run the full pipeline so a retried recording reaches `done`, not just `transcribed`.
  // Each function swallows errors and sets status='error', so sequencing is safe.
  await runTranscription(id);
  const rec = await db.query.recordings.findFirst({ where: eq(recordings.id, id) });
  if (rec?.status === "transcribed") {
    await runEnhancement(id);
  }
  return NextResponse.json({ ok: true });
}
