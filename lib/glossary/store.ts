import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { glossary } from "@/db/schema"
import { ownerPredicate } from "@/lib/auth/ownership"

export interface GlossaryEntry {
  id: string
  term: string
  aliases: string[]
  createdAt: Date
}

export async function getGlossary(ownerId: string): Promise<GlossaryEntry[]> {
  const rows = await db.query.glossary.findMany({
    where: ownerPredicate(glossary.ownerId, ownerId),
  })
  return rows.map((r) => ({
    id: r.id,
    term: r.term,
    aliases: r.aliases ?? [],
    createdAt: r.createdAt,
  }))
}

export async function addEntry(
  ownerId: string,
  input: { term: string; aliases?: string[] }
): Promise<GlossaryEntry> {
  const [row] = await db
    .insert(glossary)
    .values({ ownerId, term: input.term.trim(), aliases: input.aliases ?? [] })
    .returning()
  return {
    id: row.id,
    term: row.term,
    aliases: row.aliases ?? [],
    createdAt: row.createdAt,
  }
}

export async function updateEntry(
  ownerId: string,
  id: string,
  input: { term?: string; aliases?: string[] }
): Promise<boolean> {
  const patch: Record<string, unknown> = {}
  if (input.term !== undefined) patch.term = input.term.trim()
  if (input.aliases !== undefined) patch.aliases = input.aliases
  if (Object.keys(patch).length === 0) {
    return Boolean(
      await db.query.glossary.findFirst({
        where: and(
          eq(glossary.id, id),
          ownerPredicate(glossary.ownerId, ownerId)
        ),
        columns: { id: true },
      })
    )
  }
  const updated = await db
    .update(glossary)
    .set(patch)
    .where(and(eq(glossary.id, id), ownerPredicate(glossary.ownerId, ownerId)))
    .returning({ id: glossary.id })
  return updated.length > 0
}

export async function deleteEntry(
  ownerId: string,
  id: string
): Promise<boolean> {
  const deleted = await db
    .delete(glossary)
    .where(and(eq(glossary.id, id), ownerPredicate(glossary.ownerId, ownerId)))
    .returning({ id: glossary.id })
  return deleted.length > 0
}
