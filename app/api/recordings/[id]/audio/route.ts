import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { getStorage } from "@/lib/storage";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const rec = await db.query.recordings.findFirst({ where: eq(recordings.id, id) });
  if (!rec) return NextResponse.json({ error: "not found" }, { status: 404 });
  const url = await getStorage().presignedGetUrl(rec.storageKey, 3600);
  return NextResponse.redirect(url);
}
