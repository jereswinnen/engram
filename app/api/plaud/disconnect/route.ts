import { NextRequest, NextResponse } from "next/server"
import { disconnect } from "@/lib/plaud/mcp/client"
import { isAuthFailure, requirePrincipal } from "@/lib/auth/policy"

export async function POST(request: NextRequest) {
  const principal = await requirePrincipal(request, {
    scopes: ["plaud:write"],
    mechanisms: ["session"],
  })
  if (isAuthFailure(principal)) return principal
  await disconnect(principal.userId)
  return NextResponse.json({ connected: false })
}
