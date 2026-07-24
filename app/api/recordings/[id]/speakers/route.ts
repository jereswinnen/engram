import { NextRequest, NextResponse } from "next/server"
import { setRecordingSpeaker } from "@/lib/speakers/store"
import { isAuthFailure, requirePrincipal } from "@/lib/auth/policy"

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const principal = await requirePrincipal(request, {
    scopes: ["recordings:write"],
    mechanisms: ["session"],
  })
  if (isAuthFailure(principal)) return principal

  const { id } = await params
  const body = await request.json()
  const { label, name } = body as { label: unknown; name: unknown }
  if (typeof label !== "string" || typeof name !== "string") {
    return NextResponse.json(
      { error: "label and name required" },
      { status: 400 }
    )
  }

  if (!(await setRecordingSpeaker(principal.userId, id, label, name))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
