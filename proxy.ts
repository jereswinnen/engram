import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getSessionCookie } from "better-auth/cookies"

/**
 * Route protection proxy (Next.js 16 — renamed from middleware).
 *
 * Performs an optimistic cookie-presence check (no DB call) so every request
 * stays fast.  The real session validation happens inside server components /
 * route handlers via auth.api.getSession.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow routes with their own authentication through. Redirecting their bearer
  // requests would preserve POST and send it to /login instead of the route handler.
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/.well-known/") ||
    pathname === "/login" ||
    pathname === "/oauth/consent" ||
    pathname.startsWith("/mcp") ||
    pathname === "/api/recordings" ||
    pathname === "/api/recordings/initiate" ||
    /^\/api\/recordings\/[^/]+$/.test(pathname) ||
    /^\/api\/recordings\/[^/]+\/complete$/.test(pathname)
  ) {
    return NextResponse.next()
  }

  // Optimistic check: does a Better Auth session cookie exist?
  const sessionCookie = getSessionCookie(request)
  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("callbackUrl", pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all paths except Next.js internals and static files.
     * Regex from: https://nextjs.org/docs/app/building-your-application/routing/middleware
     */
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
