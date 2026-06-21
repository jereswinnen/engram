import { NextRequest, NextResponse } from "next/server";
import { runTranscription } from "@/lib/pipeline";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await runTranscription(id);
  return NextResponse.json({ ok: true });
}
