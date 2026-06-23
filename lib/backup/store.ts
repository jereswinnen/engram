import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { backups } from "@/db/schema";

export interface Backup {
  id: string;
  status: string;
  storageKey: string | null;
  sizeBytes: number | null;
  error: string | null;
  createdAt: Date;
}

export async function createBackup(): Promise<Backup> {
  const [row] = await db.insert(backups).values({}).returning();
  return row as Backup;
}

export async function getBackups(): Promise<Backup[]> {
  return (await db.query.backups.findMany({ orderBy: [desc(backups.createdAt)] })) as Backup[];
}

export async function markReady(id: string, storageKey: string, sizeBytes: number): Promise<void> {
  await db.update(backups).set({ status: "ready", storageKey, sizeBytes }).where(eq(backups.id, id));
}

export async function markError(id: string, error: string): Promise<void> {
  await db.update(backups).set({ status: "error", error }).where(eq(backups.id, id));
}
