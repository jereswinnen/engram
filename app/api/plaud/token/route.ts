import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { savePlaudToken, hasPlaudToken } from "@/lib/plaud/credentials";
import { validateToken } from "@/lib/plaud/client";

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ connected: await hasPlaudToken() });
}

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { token?: string };
  try {
    body = (await request.json()) as { token?: string };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const trimmed = body.token?.trim();
  if (!trimmed || trimmed.length < 20) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }
  // Best-effort validation; still save (lets the user save even if validate is flaky).
  const valid = await validateToken(trimmed).catch(() => false);
  await savePlaudToken(trimmed);
  return NextResponse.json({ connected: true, valid });
}
