import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { disconnect } from "@/lib/plaud/mcp/client";

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await disconnect();
  return NextResponse.json({ connected: false });
}
