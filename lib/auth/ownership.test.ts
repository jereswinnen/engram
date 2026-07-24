import { pgTable, text } from "drizzle-orm/pg-core"
import { describe, expect, it } from "vitest"
import { canReadUnownedLegacyRows, ownerPredicate } from "./ownership"

const table = pgTable("owner_test", { ownerId: text("owner_id") })

describe("ownerPredicate", () => {
  it("uses a strict owner comparison by default", () => {
    expect(canReadUnownedLegacyRows("user-a", {})).toBe(false)
    expect(ownerPredicate(table.ownerId, "user-a", {})).toBeDefined()
  })

  it("allows null legacy rows only for the explicit canonical owner", () => {
    const env = {
      AUTH_ALLOW_UNOWNED_LEGACY_DATA: "true",
      LEGACY_MAC_RECORDER_OWNER_ID: "user-a",
    }
    expect(canReadUnownedLegacyRows("user-a", env)).toBe(true)
    expect(canReadUnownedLegacyRows("user-b", env)).toBe(false)
  })
})
