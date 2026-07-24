import { NextRequest, NextResponse } from "next/server"
import { syncPlaud } from "@/lib/plaud/sync"
import { isAuthFailure, requirePrincipal } from "@/lib/auth/policy"

// Plaud sync is now a manual, browser-only fallback. The retired Railway cron
// no longer has a bearer-token path into this endpoint.
export async function POST(request: NextRequest) {
  const principal = await requirePrincipal(request, {
    scopes: ["plaud:write"],
    mechanisms: ["session"],
  })
  if (isAuthFailure(principal)) return principal
  const result = await syncPlaud(principal.userId)
  return NextResponse.json(result)
}
