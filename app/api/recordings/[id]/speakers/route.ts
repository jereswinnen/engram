import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { setRecordingSpeaker } from "@/lib/speakers/store";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const { label, name } = body as { label: unknown; name: unknown };
  if (typeof label !== "string" || typeof name !== "string") {
    return NextResponse.json({ error: "label and name required" }, { status: 400 });
  }

  await setRecordingSpeaker(id, label, name);
  return NextResponse.json({ ok: true });
}
