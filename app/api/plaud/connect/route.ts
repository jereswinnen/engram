import { NextRequest, NextResponse } from "next/server"
import { beginAuth } from "@/lib/plaud/mcp/client"
import { isAuthFailure, requirePrincipal } from "@/lib/auth/policy"

export async function GET(request: NextRequest) {
  const principal = await requirePrincipal(request, {
    scopes: ["plaud:write"],
    mechanisms: ["session"],
  })
  if (isAuthFailure(principal)) return principal
  try {
    const url = await beginAuth(principal.userId)
    return NextResponse.redirect(url)
  } catch (e) {
    console.error("[plaud oauth]", e)
    return NextResponse.redirect(new URL("/settings?plaud=error", request.url))
  }
}
