import { NextRequest, NextResponse } from "next/server"
import { createBackup, getBackups, markError } from "@/lib/backup/store"
import { buildBackup } from "@/lib/backup/build"
import { isAuthFailure, requirePrincipal } from "@/lib/auth/policy"

export async function GET(request: NextRequest) {
  const principal = await requirePrincipal(request, {
    scopes: ["backups:read"],
    mechanisms: ["session"],
  })
  if (isAuthFailure(principal)) return principal
  return NextResponse.json(await getBackups(principal.userId))
}

export async function POST(request: NextRequest) {
  const principal = await requirePrincipal(request, {
    scopes: ["backups:write"],
    mechanisms: ["session"],
  })
  if (isAuthFailure(principal)) return principal
  const backup = await createBackup(principal.userId)
  // fire-and-forget; outer catch ensures the row never stays stuck pending on a thrown error
  buildBackup(principal.userId, backup.id).catch((e) =>
    markError(
      principal.userId,
      backup.id,
      e instanceof Error ? e.message : String(e)
    )
  )
  return NextResponse.json({ id: backup.id }, { status: 201 })
}
