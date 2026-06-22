import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { finishAuth } from "@/lib/plaud/mcp/client";

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.redirect(new URL("/login", request.url));
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/settings?plaud=error", request.url));
  try {
    await finishAuth(code);
    return NextResponse.redirect(new URL("/settings?plaud=connected", request.url));
  } catch {
    return NextResponse.redirect(new URL("/settings?plaud=error", request.url));
  }
}
