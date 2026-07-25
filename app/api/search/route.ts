import { NextResponse } from "next/server"
import { isAuthFailure, requirePrincipal } from "@/lib/auth/policy"
import { searchRecordings } from "@/lib/search/search"

export function parseSearchQuery(request: Request): string | null {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? ""
  return query.length > 0 && query.length <= 500 ? query : null
}

export async function GET(request: Request) {
  const principal = await requirePrincipal(request, {
    scopes: ["transcripts:search"],
  })
  if (isAuthFailure(principal)) return principal

  const query = parseSearchQuery(request)
  if (!query) {
    return NextResponse.json(
      { error: "q must contain between 1 and 500 characters" },
      { status: 400 }
    )
  }

  const results = await searchRecordings(principal.userId, query)
  return NextResponse.json({ query, results })
}
