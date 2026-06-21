import { NextRequest, NextResponse } from "next/server";
import { runTranscription } from "@/lib/pipeline";
import { auth } from "@/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await runTranscription(id);
  return NextResponse.json({ ok: true });
}
