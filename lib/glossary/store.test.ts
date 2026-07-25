import { describe, it, expect, beforeEach, vi } from "vitest"

const rows: any[] = []
vi.mock("@/db", () => ({
  db: {
    query: {
      glossary: {
        findMany: async () => rows.slice(),
        findFirst: async () => rows[0] ?? null,
      },
    },
    insert: () => ({
      values: (v: any) => ({
        returning: async () => {
          const row = {
            id: `g${rows.length}`,
            createdAt: new Date(),
            aliases: [],
            ...v,
          }
          rows.push(row)
          return [row]
        },
      }),
    }),
    update: () => ({
      set: (v: any) => ({
        where: () => ({
          returning: async () => {
            if (!rows[0]) return []
            Object.assign(rows[0], v)
            return [{ id: rows[0].id }]
          },
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: async () => {
          if (!rows[0]) return []
          const [row] = rows.splice(0, 1)
          return [{ id: row.id }]
        },
      }),
    }),
  },
}))

beforeEach(() => {
  rows.length = 0
})

describe("glossary store", () => {
  it("adds and lists entries", async () => {
    const { addEntry, getGlossary } = await import("./store")
    await addEntry("user-a", { term: "Riffado", aliases: ["Rifado"] })
    const all = await getGlossary("user-a")
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ term: "Riffado", aliases: ["Rifado"] })
  })
  it("defaults aliases to [] when omitted", async () => {
    const { addEntry } = await import("./store")
    const e = await addEntry("user-a", { term: "Engram" })
    expect(e.aliases).toEqual([])
  })
})
