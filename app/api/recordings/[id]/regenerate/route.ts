import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { runEnhancement } from "@/lib/pipeline";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await runEnhancement(id);
  return NextResponse.json({ ok: true });
}
