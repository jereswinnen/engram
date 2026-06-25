import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Route protection proxy (Next.js 16 — renamed from middleware).
 *
 * Performs an optimistic cookie-presence check (no DB call) so every request
 * stays fast.  The real session validation happens inside server components /
 * route handlers via auth.api.getSession.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow the auth API and the login page through. /api/sync is also let
  // through: it's called by the cron with a Bearer CRON_SECRET (no session cookie),
  // and its handler does its own authorization (Bearer secret OR a valid session),
  // so the optimistic cookie redirect below must not turn its POST into a redirect
  // to /login (a 307 keeps the method → POST /login → 405).
  if (pathname.startsWith("/api/auth") || pathname === "/login" || pathname === "/api/sync") {
    return NextResponse.next();
  }

  // Optimistic check: does a Better Auth session cookie exist?
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all paths except Next.js internals and static files.
     * Regex from: https://nextjs.org/docs/app/building-your-application/routing/middleware
     */
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
