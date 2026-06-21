import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { getStorage } from "@/lib/storage";
import { auth } from "@/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const rec = await db.query.recordings.findFirst({ where: eq(recordings.id, id) });
  if (!rec) return NextResponse.json({ error: "not found" }, { status: 404 });
  const url = await getStorage().presignedGetUrl(rec.storageKey, 3600);
  return NextResponse.redirect(url);
}
