import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createBackup, getBackups, markError } from "@/lib/backup/store";
import { buildBackup } from "@/lib/backup/build";

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getBackups());
}

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const backup = await createBackup();
  // fire-and-forget; outer catch ensures the row never stays stuck pending on a thrown error
  buildBackup(backup.id).catch((e) => markError(backup.id, e instanceof Error ? e.message : String(e)));
  return NextResponse.json({ id: backup.id }, { status: 201 });
}
