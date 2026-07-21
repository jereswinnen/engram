import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { syncPlaud } from "@/lib/plaud/sync"

// Plaud sync is now a manual, browser-only fallback. The retired Railway cron
// no longer has a bearer-token path into this endpoint.
export async function isAuthorized(request: Request): Promise<boolean> {
  const session = await auth.api.getSession({ headers: request.headers })
  return Boolean(session)
}

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const result = await syncPlaud()
  return NextResponse.json(result)
}
