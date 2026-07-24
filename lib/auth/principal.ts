import { timingSafeEqual } from "node:crypto"

export const LEGACY_MAC_CONNECTION_ID = "00000000-0000-4000-8000-000000000001"

export const BROWSER_SCOPES = [
  "recordings:read",
  "recordings:write",
  "recordings:delete-own",
  "transcripts:search",
  "transcripts:read",
  "settings:read",
  "settings:write",
  "backups:read",
  "backups:write",
  "plaud:read",
  "plaud:write",
] as const

export const LEGACY_MAC_SCOPES = [
  "recordings:write",
  "recordings:delete-own",
] as const

export type AuthPrincipal = {
  userId: string
  mechanism: "session" | "oauth" | "legacy-mac"
  scopes: ReadonlySet<string>
  audience?: string
  clientId?: string
  grantId?: string
  connectionId?: string
}

type SessionResult = { user: { id: string } } | null

type AuthenticationDependencies = {
  env?: Record<string, string | undefined>
  getSession?: (headers: Headers) => Promise<SessionResult>
}

function matchesSecret(supplied: string, expected: string): boolean {
  const suppliedBytes = Buffer.from(supplied)
  const expectedBytes = Buffer.from(expected)
  return (
    suppliedBytes.length === expectedBytes.length &&
    timingSafeEqual(suppliedBytes, expectedBytes)
  )
}

export async function authenticateRequest(
  request: Request,
  dependencies: AuthenticationDependencies = {}
): Promise<AuthPrincipal | null> {
  const env = dependencies.env ?? process.env
  const authorization = request.headers.get("authorization")

  // Authorization headers always take precedence. A malformed, expired, or
  // otherwise invalid bearer must never fall back to a browser cookie.
  if (authorization !== null) {
    if (!authorization.startsWith("Bearer ")) return null

    const legacyEnabled = env.AUTH_LEGACY_MAC_ENABLED !== "false"
    const legacyToken = env.MAC_RECORDER_API_TOKEN
    const legacyOwnerId = env.LEGACY_MAC_RECORDER_OWNER_ID
    const supplied = authorization.slice("Bearer ".length)
    if (
      legacyEnabled &&
      legacyToken &&
      legacyOwnerId &&
      supplied &&
      matchesSecret(supplied, legacyToken)
    ) {
      return {
        userId: legacyOwnerId,
        mechanism: "legacy-mac",
        scopes: new Set(LEGACY_MAC_SCOPES),
        clientId: "engram-macos-legacy",
        grantId: LEGACY_MAC_CONNECTION_ID,
        connectionId: LEGACY_MAC_CONNECTION_ID,
      }
    }

    // OAuth bearer verification is added behind AUTH_OAUTH_BEARER_ENABLED in
    // Phase 2. Until then every other Authorization value fails closed.
    return null
  }

  const getSession =
    dependencies.getSession ??
    (async (headers: Headers) => {
      const { auth } = await import("@/auth")
      return auth.api.getSession({ headers })
    })
  const session = await getSession(request.headers)
  if (!session) return null

  return {
    userId: session.user.id,
    mechanism: "session",
    scopes: new Set(BROWSER_SCOPES),
  }
}
