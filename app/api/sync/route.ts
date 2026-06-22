import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncPlaud } from "@/lib/plaud/sync";

// Authorized if the request carries the cron shared-secret OR a valid session.
// Reads CRON_SECRET via process.env directly so a missing secret doesn't throw
// in environments that only use the session path.
export async function isAuthorized(request: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const authz = request.headers.get("authorization");
  if (secret && authz === `Bearer ${secret}`) return true;
  const session = await auth.api.getSession({ headers: request.headers });
  return Boolean(session);
}

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await syncPlaud();
  return NextResponse.json(result);
}
