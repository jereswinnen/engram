import { NextRequest, NextResponse } from "next/server"
import { runEnhancement } from "@/lib/pipeline"
import { isAuthFailure, requirePrincipal } from "@/lib/auth/policy"
import { getOwnedRecording } from "@/lib/recordings/store"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const principal = await requirePrincipal(request, {
    scopes: ["recordings:write"],
    mechanisms: ["session"],
  })
  if (isAuthFailure(principal)) return principal

  const { id } = await params
  if (!(await getOwnedRecording(principal.userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  await runEnhancement(principal.userId, id)

  const rec = await getOwnedRecording(principal.userId, id)
  if (rec?.status === "error") {
    return NextResponse.json(
      { error: rec.errorMessage ?? "regeneration failed" },
      { status: 500 }
    )
  }
  return NextResponse.json({ ok: true })
}
