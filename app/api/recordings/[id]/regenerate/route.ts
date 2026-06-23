import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { runEnhancement } from "@/lib/pipeline";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await runEnhancement(id);

  const rec = await db.query.recordings.findFirst({ where: eq(recordings.id, id) });
  if (rec?.status === "error") {
    return NextResponse.json(
      { error: rec.errorMessage ?? "regeneration failed" },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
