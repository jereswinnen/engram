import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { updateEntry, deleteEntry } from "@/lib/glossary/store";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  const patch: { term?: string; aliases?: string[] } = {};
  if (typeof body?.term === "string") {
    const t = body.term.trim();
    if (!t) return NextResponse.json({ error: "term cannot be empty" }, { status: 400 });
    patch.term = t;
  }
  if (Array.isArray(body?.aliases)) {
    patch.aliases = body.aliases.map((a: unknown) => (typeof a === "string" ? a.trim() : "")).filter(Boolean);
  }
  await updateEntry(id, patch);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await deleteEntry(id);
  return NextResponse.json({ ok: true });
}
