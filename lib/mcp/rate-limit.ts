import { createHash } from "node:crypto"
import { sql } from "drizzle-orm"
import { db } from "@/db"

export type McpToolName =
  | "search"
  | "fetch"
  | "get_transcript_page"
  | "get_summary"

export type RateLimitResult = {
  allowed: boolean
  limit: number
  remaining: number
  retryAfterSeconds: number
}

type RateLimitRow = { request_count: number | string }

type RateLimitDependencies = {
  now?: Date
  execute?: typeof db.execute
  cleanup?: boolean
}

const WINDOW_MILLISECONDS = 60_000
const RETENTION_MILLISECONDS = 5 * WINDOW_MILLISECONDS

export const MCP_TOOL_RATE_LIMITS: Record<McpToolName, number> = {
  search: 20,
  fetch: 60,
  get_transcript_page: 60,
  get_summary: 60,
}

export function rateLimitKey(input: {
  userId: string
  clientId?: string
  tool: McpToolName
}): string {
  return createHash("sha256")
    .update(`${input.userId}\0${input.clientId ?? "unknown"}\0${input.tool}`)
    .digest("hex")
}

export async function checkMcpRateLimit(
  input: { userId: string; clientId?: string; tool: McpToolName },
  dependencies: RateLimitDependencies = {}
): Promise<RateLimitResult> {
  const now = dependencies.now ?? new Date()
  const windowStart = new Date(
    Math.floor(now.getTime() / WINDOW_MILLISECONDS) * WINDOW_MILLISECONDS
  )
  const windowEnd = new Date(windowStart.getTime() + WINDOW_MILLISECONDS)
  const expiresAt = new Date(windowStart.getTime() + RETENTION_MILLISECONDS)
  const keyDigest = rateLimitKey(input)
  const execute = dependencies.execute ?? db.execute.bind(db)
  const limit = MCP_TOOL_RATE_LIMITS[input.tool]

  const rows = (await execute(sql`
    INSERT INTO mcp_rate_limit_buckets (
      key_digest,
      window_start,
      request_count,
      expires_at
    )
    VALUES (
      ${keyDigest},
      ${windowStart.toISOString()}::timestamp,
      1,
      ${expiresAt.toISOString()}::timestamp
    )
    ON CONFLICT (key_digest, window_start)
    DO UPDATE SET request_count = mcp_rate_limit_buckets.request_count + 1
    RETURNING request_count
  `)) as unknown as RateLimitRow[]
  const count = Number(rows[0]?.request_count ?? limit + 1)

  if (dependencies.cleanup) {
    try {
      await execute(sql`
        DELETE FROM mcp_rate_limit_buckets
        WHERE expires_at < ${now.toISOString()}::timestamp
      `)
    } catch {
      // Cleanup is opportunistic and must not change the bucket decision.
    }
  }

  return {
    allowed: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((windowEnd.getTime() - now.getTime()) / 1000)
    ),
  }
}
