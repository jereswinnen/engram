import { NextRequest, NextResponse } from "next/server"
import { runTranscription, runEnhancement } from "@/lib/pipeline"
import { isAuthFailure, requirePrincipal } from "@/lib/auth/policy"
import { getOwnedRecording } from "@/lib/recordings/store"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const principal = await requirePrincipal(req, {
    scopes: ["recordings:write"],
    mechanisms: ["session"],
  })
  if (isAuthFailure(principal)) return principal

  const { id } = await params
  if (!(await getOwnedRecording(principal.userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  // Run the full pipeline so a retried recording reaches `done`, not just `transcribed`.
  // Each function swallows errors and sets status='error', so sequencing is safe.
  await runTranscription(principal.userId, id)
  const rec = await getOwnedRecording(principal.userId, id)
  if (rec?.status === "transcribed") {
    await runEnhancement(principal.userId, id)
  }
  return NextResponse.json({ ok: true })
}
