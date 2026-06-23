import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { backups } from "@/db/schema";
import { getStorage } from "@/lib/storage";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const backup = await db.query.backups.findFirst({ where: eq(backups.id, id) });
  if (!backup || backup.status !== "ready" || !backup.storageKey) {
    return NextResponse.json({ error: "backup not ready" }, { status: 409 });
  }
  const url = await getStorage().presignedGetUrl(backup.storageKey, 300);
  return NextResponse.redirect(url);
}
