import { NextResponse } from "next/server"
import { isAuthFailure, requirePrincipal } from "@/lib/auth/policy"
import {
  SEARCH_API_VERSION,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
  SEARCH_MAX_OFFSET,
} from "@/lib/search/constants"
import { searchRecordings } from "@/lib/search/search"

export function parseSearchQuery(request: Request): string | null {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? ""
  return query.length > 0 && query.length <= 500 ? query : null
}

function parseIntegerParameter(
  request: Request,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number | null {
  const raw = new URL(request.url).searchParams.get(name)
  if (raw === null) return fallback
  const value = Number(raw)
  return Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : null
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

  const limit = parseIntegerParameter(
    request,
    "limit",
    SEARCH_DEFAULT_LIMIT,
    1,
    SEARCH_MAX_LIMIT
  )
  const offset = parseIntegerParameter(
    request,
    "offset",
    0,
    0,
    SEARCH_MAX_OFFSET
  )
  if (limit === null || offset === null) {
    return NextResponse.json(
      {
        error: `limit must be 1-${SEARCH_MAX_LIMIT} and offset must be 0-${SEARCH_MAX_OFFSET}`,
      },
      { status: 400 }
    )
  }

  const page = await searchRecordings(principal.userId, query, {
    limit,
    offset,
  })
  return NextResponse.json({
    version: SEARCH_API_VERSION,
    query,
    ...page,
  })
}
