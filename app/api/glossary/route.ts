import { NextRequest, NextResponse } from "next/server"
import { getGlossary, addEntry } from "@/lib/glossary/store"
import { parseEntryInput } from "./utils"
import { isAuthFailure, requirePrincipal } from "@/lib/auth/policy"

export { parseEntryInput }

export async function GET(request: NextRequest) {
  const principal = await requirePrincipal(request, {
    scopes: ["settings:read"],
    mechanisms: ["session"],
  })
  if (isAuthFailure(principal)) return principal
  return NextResponse.json(await getGlossary(principal.userId))
}

export async function POST(request: NextRequest) {
  const principal = await requirePrincipal(request, {
    scopes: ["settings:write"],
    mechanisms: ["session"],
  })
  if (isAuthFailure(principal)) return principal
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 })
  }
  const parsed = parseEntryInput(body)
  if (!parsed)
    return NextResponse.json({ error: "term required" }, { status: 400 })
  const entry = await addEntry(principal.userId, parsed)
  return NextResponse.json({ id: entry.id }, { status: 201 })
}
