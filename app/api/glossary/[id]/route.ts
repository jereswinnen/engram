import { NextRequest, NextResponse } from "next/server"
import { updateEntry, deleteEntry } from "@/lib/glossary/store"
import { isAuthFailure, requirePrincipal } from "@/lib/auth/policy"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const principal = await requirePrincipal(request, {
    scopes: ["settings:write"],
    mechanisms: ["session"],
  })
  if (isAuthFailure(principal)) return principal
  const { id } = await params
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 })
  }
  const patch: { term?: string; aliases?: string[] } = {}
  if (typeof body?.term === "string") {
    const t = body.term.trim()
    if (!t)
      return NextResponse.json(
        { error: "term cannot be empty" },
        { status: 400 }
      )
    patch.term = t
  }
  if (Array.isArray(body?.aliases)) {
    patch.aliases = body.aliases
      .map((a: unknown) => (typeof a === "string" ? a.trim() : ""))
      .filter(Boolean)
  }
  if (!(await updateEntry(principal.userId, id, patch))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const principal = await requirePrincipal(request, {
    scopes: ["settings:write"],
    mechanisms: ["session"],
  })
  if (isAuthFailure(principal)) return principal
  const { id } = await params
  if (!(await deleteEntry(principal.userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
