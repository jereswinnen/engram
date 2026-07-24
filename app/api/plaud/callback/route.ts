import { NextRequest, NextResponse } from "next/server"
import { finishAuth } from "@/lib/plaud/mcp/client"
import { isAuthFailure, requirePrincipal } from "@/lib/auth/policy"

export async function GET(request: NextRequest) {
  const principal = await requirePrincipal(request, {
    scopes: ["plaud:write"],
    mechanisms: ["session"],
  })
  if (isAuthFailure(principal)) return principal
  const code = request.nextUrl.searchParams.get("code")
  const state = request.nextUrl.searchParams.get("state")
  if (!code || !state)
    return NextResponse.redirect(new URL("/settings?plaud=error", request.url))
  try {
    await finishAuth(principal.userId, code, state)
    return NextResponse.redirect(
      new URL("/settings?plaud=connected", request.url)
    )
  } catch (e) {
    console.error("[plaud oauth]", e)
    return NextResponse.redirect(new URL("/settings?plaud=error", request.url))
  }
}
