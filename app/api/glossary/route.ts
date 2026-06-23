import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getGlossary, addEntry } from "@/lib/glossary/store";
import { parseEntryInput } from "./utils";

export { parseEntryInput };

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getGlossary());
}

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  const parsed = parseEntryInput(body);
  if (!parsed) return NextResponse.json({ error: "term required" }, { status: 400 });
  const entry = await addEntry(parsed);
  return NextResponse.json({ id: entry.id }, { status: 201 });
}
