import { eq } from "drizzle-orm";
import { db } from "@/db";
import { glossary } from "@/db/schema";

export interface GlossaryEntry {
  id: string;
  term: string;
  aliases: string[];
  createdAt: Date;
}

export async function getGlossary(): Promise<GlossaryEntry[]> {
  const rows = await db.query.glossary.findMany();
  return rows.map((r: any) => ({ id: r.id, term: r.term, aliases: r.aliases ?? [], createdAt: r.createdAt }));
}

export async function addEntry(input: { term: string; aliases?: string[] }): Promise<GlossaryEntry> {
  const [row] = await db
    .insert(glossary)
    .values({ term: input.term.trim(), aliases: input.aliases ?? [] })
    .returning();
  return { id: row.id, term: row.term, aliases: row.aliases ?? [], createdAt: row.createdAt };
}

export async function updateEntry(id: string, input: { term?: string; aliases?: string[] }): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (input.term !== undefined) patch.term = input.term.trim();
  if (input.aliases !== undefined) patch.aliases = input.aliases;
  if (Object.keys(patch).length === 0) return;
  await db.update(glossary).set(patch).where(eq(glossary.id, id));
}

export async function deleteEntry(id: string): Promise<void> {
  await db.delete(glossary).where(eq(glossary.id, id));
}
