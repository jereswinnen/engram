import { eq, isNull, or, type SQL } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"

/**
 * Phase 1A compatibility predicate. New rows always receive ownerId. Existing
 * null-owned rows are visible only to one explicitly configured owner and only
 * while the temporary compatibility flag is true.
 */
export function ownerPredicate(
  column: AnyPgColumn,
  ownerId: string,
  env: Record<string, string | undefined> = process.env
): SQL {
  const mayReadLegacyRows = canReadUnownedLegacyRows(ownerId, env)

  if (!mayReadLegacyRows) return eq(column, ownerId)
  return or(eq(column, ownerId), isNull(column))!
}

export function canReadUnownedLegacyRows(
  ownerId: string,
  env: Record<string, string | undefined> = process.env
): boolean {
  return (
    env.AUTH_ALLOW_UNOWNED_LEGACY_DATA === "true" &&
    env.LEGACY_MAC_RECORDER_OWNER_ID === ownerId
  )
}
