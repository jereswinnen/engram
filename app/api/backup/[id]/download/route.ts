import { NextRequest, NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { backups } from "@/db/schema"
import { getStorage } from "@/lib/storage"
import { ownerPredicate } from "@/lib/auth/ownership"
import { isAuthFailure, requirePrincipal } from "@/lib/auth/policy"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const principal = await requirePrincipal(request, {
    scopes: ["backups:read"],
    mechanisms: ["session"],
  })
  if (isAuthFailure(principal)) return principal
  const { id } = await params
  const backup = await db.query.backups.findFirst({
    where: and(
      eq(backups.id, id),
      ownerPredicate(backups.ownerId, principal.userId)
    ),
  })
  if (!backup) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }
  if (backup.status !== "ready" || !backup.storageKey) {
    return NextResponse.json({ error: "backup not ready" }, { status: 409 })
  }
  const url = await getStorage().presignedGetUrl(backup.storageKey, 300)
  return NextResponse.redirect(url)
}
