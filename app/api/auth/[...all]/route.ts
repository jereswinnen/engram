import { toNextJsHandler } from "better-auth/next-js"
import { auth } from "@/auth"
import {
  oauthEnabled,
  oauthUnavailableResponse,
} from "@/lib/auth/oauth-feature"

const handlers = toNextJsHandler(auth)

const ALLOWED_OAUTH_PATHS = new Set([
  "/api/auth/.well-known/oauth-authorization-server",
  "/api/auth/jwks",
  "/api/auth/oauth2/authorize",
  "/api/auth/oauth2/consent",
  "/api/auth/oauth2/continue",
  "/api/auth/oauth2/introspect",
  "/api/auth/oauth2/register",
  "/api/auth/oauth2/revoke",
  "/api/auth/oauth2/token",
])

function isOAuthPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/auth/oauth2/") ||
    pathname === "/api/auth/jwks" ||
    pathname.startsWith("/api/auth/.well-known/")
  )
}

function guarded(
  handler: (request: Request) => Promise<Response>
): (request: Request) => Promise<Response> {
  return async (request) => {
    const pathname = new URL(request.url).pathname
    if (isOAuthPath(pathname)) {
      if (!oauthEnabled() || !ALLOWED_OAUTH_PATHS.has(pathname)) {
        return oauthUnavailableResponse()
      }
    }
    const metadata = isOAuthPath(pathname)
      ? await safeOAuthRequestMetadata(request.clone())
      : null
    const response = await handler(request)
    if (metadata) {
      const reason = response.ok
        ? undefined
        : await safeOAuthError(response.clone())
      console.info(
        "auth_event",
        JSON.stringify({
          event: metadata.event,
          outcome:
            response.ok || response.status === 302 ? "success" : "failure",
          status: response.status,
          reason,
          clientId: metadata.clientId,
          grantType: metadata.grantType,
        })
      )
    }
    return response
  }
}

async function safeOAuthError(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as Record<string, unknown>
    return typeof body.error === "string" ? body.error.slice(0, 64) : undefined
  } catch {
    return undefined
  }
}

async function safeOAuthRequestMetadata(request: Request): Promise<{
  event: string
  clientId?: string
  grantType?: string
} | null> {
  const url = new URL(request.url)
  const event = url.pathname.split("/").at(-1)
  if (!event || event === "jwks") return null
  let clientId = url.searchParams.get("client_id") ?? undefined
  let grantType = url.searchParams.get("grant_type") ?? undefined
  const contentType = request.headers.get("content-type") ?? ""
  try {
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = new URLSearchParams(await request.text())
      clientId = form.get("client_id") ?? clientId
      grantType = form.get("grant_type") ?? grantType
    } else if (
      event === "register" &&
      contentType.includes("application/json")
    ) {
      const body = (await request.json()) as Record<string, unknown>
      clientId = typeof body.client_id === "string" ? body.client_id : clientId
    }
  } catch {
    // Parsing is observability-only; the provider still owns request validation.
  }
  return { event: `oauth_${event}`, clientId, grantType }
}

export const GET = guarded(handlers.GET)
export const POST = guarded(handlers.POST)
export const PUT = guarded(handlers.PUT)
export const PATCH = guarded(handlers.PATCH)
export const DELETE = guarded(handlers.DELETE)
