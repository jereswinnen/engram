import { describe, it, expect, beforeEach, vi } from "vitest";

const rows: any[] = [];
vi.mock("@/db", () => ({
  db: {
    query: { glossary: { findMany: async () => rows.slice() } },
    insert: () => ({ values: (v: any) => ({ returning: async () => { const row = { id: `g${rows.length}`, createdAt: new Date(), aliases: [], ...v }; rows.push(row); return [row]; } }) }),
    update: () => ({ set: (v: any) => ({ where: async () => { Object.assign(rows[0], v); } }) }),
    delete: () => ({ where: async () => { rows.length = 0; } }),
  },
}));

beforeEach(() => { rows.length = 0; });

describe("glossary store", () => {
  it("adds and lists entries", async () => {
    const { addEntry, getGlossary } = await import("./store");
    await addEntry({ term: "Riffado", aliases: ["Rifado"] });
    const all = await getGlossary();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ term: "Riffado", aliases: ["Rifado"] });
  });
  it("defaults aliases to [] when omitted", async () => {
    const { addEntry } = await import("./store");
    const e = await addEntry({ term: "Engram" });
    expect(e.aliases).toEqual([]);
  });
});
