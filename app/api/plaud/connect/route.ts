import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { beginAuth } from "@/lib/plaud/mcp/client";

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.redirect(new URL("/login", request.url));
  try {
    const url = await beginAuth();
    return NextResponse.redirect(url);
  } catch {
    return NextResponse.redirect(new URL("/settings?plaud=error", request.url));
  }
}
