import { NextRequest, NextResponse } from "next/server"
import { getStorage } from "@/lib/storage"
import { isAuthFailure, requirePrincipal } from "@/lib/auth/policy"
import { getOwnedRecording } from "@/lib/recordings/store"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const principal = await requirePrincipal(req, { scopes: ["recordings:read"] })
  if (isAuthFailure(principal)) return principal

  const { id } = await params
  const rec = await getOwnedRecording(principal.userId, id)
  if (!rec) return NextResponse.json({ error: "not found" }, { status: 404 })
  const url = await getStorage().presignedGetUrl(rec.storageKey, 3600)
  return NextResponse.redirect(url)
}
