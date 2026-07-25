import { and, eq, desc } from "drizzle-orm"
import { db } from "@/db"
import { backups } from "@/db/schema"
import { ownerPredicate } from "@/lib/auth/ownership"

export interface Backup {
  id: string
  status: string
  storageKey: string | null
  sizeBytes: number | null
  error: string | null
  createdAt: Date
}

export async function createBackup(ownerId: string): Promise<Backup> {
  const [row] = await db.insert(backups).values({ ownerId }).returning()
  return row as Backup
}

export async function getBackups(ownerId: string): Promise<Backup[]> {
  return (await db.query.backups.findMany({
    where: ownerPredicate(backups.ownerId, ownerId),
    orderBy: [desc(backups.createdAt)],
  })) as Backup[]
}

export async function markReady(
  ownerId: string,
  id: string,
  storageKey: string,
  sizeBytes: number
): Promise<void> {
  await db
    .update(backups)
    .set({ status: "ready", storageKey, sizeBytes })
    .where(and(eq(backups.id, id), ownerPredicate(backups.ownerId, ownerId)))
}

export async function markError(
  ownerId: string,
  id: string,
  error: string
): Promise<void> {
  await db
    .update(backups)
    .set({ status: "error", error })
    .where(and(eq(backups.id, id), ownerPredicate(backups.ownerId, ownerId)))
}
