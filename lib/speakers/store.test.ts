import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory state shared across mock and tests
const speakersRows: any[] = [];
const rsRows: any[] = [];

// ---------------------------------------------------------------------------
// Parse a Drizzle SQL eq() or and() expression into a plain { field: value }
// filter object so the mock can do real in-memory filtering.
//
// Drizzle's eq(col, val) produces a SQL instance whose queryChunks are:
//   [0] ""  [1] column  [2] " = "  [3] Param(value)  [4] ""
//
// Drizzle's and(cond1, cond2) produces:
//   [0] "("  [1] SQL{ [eq1, " and ", eq2] }  [2] ")"
// ---------------------------------------------------------------------------
function toCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function parseWhere(expr: any): Record<string, unknown> {
  const chunks: any[] = expr?.queryChunks ?? [];

  // eq(col, val) — 5 chunks, third is " = "
  if (chunks.length === 5 && chunks[2]?.value?.[0] === " = ") {
    const colName: string = chunks[1]?.name ?? "";
    const jsKey = toCamel(colName);
    return { [jsKey]: chunks[3]?.value };
  }

  // and(...conditions) — 3 chunks: "(", inner SQL, ")"
  if (chunks.length === 3 && chunks[0]?.value?.[0] === "(") {
    const innerChunks: any[] = chunks[1]?.queryChunks ?? [];
    const result: Record<string, unknown> = {};
    for (const chunk of innerChunks) {
      if (chunk?.queryChunks?.length === 5) {
        Object.assign(result, parseWhere(chunk));
      }
    }
    return result;
  }

  return {};
}

function rowMatches(row: any, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, v]) => row[k] === v);
}

vi.mock("@/db", () => ({
  db: {
    query: {
      speakers: {
        findFirst: async ({ where }: any) => {
          const f = parseWhere(where);
          return speakersRows.find((r) => rowMatches(r, f));
        },
        findMany: async () => speakersRows.slice(),
      },
      recordingSpeakers: {
        findFirst: async ({ where }: any) => {
          const f = parseWhere(where);
          return rsRows.find((r) => rowMatches(r, f));
        },
      },
    },
    insert: (_table: any) => ({
      values: (vals: any) => {
        // Push to the correct in-memory store immediately
        let row: any;
        if ("recordingId" in vals) {
          row = { id: `rs${rsRows.length}`, ...vals, createdAt: new Date() };
          rsRows.push(row);
        } else {
          row = { id: `sp${speakersRows.length}`, ...vals, createdAt: new Date() };
          speakersRows.push(row);
        }
        // Return a thenable Promise that also exposes .returning()
        // so the mock works both for `await values()` and `await values().returning()`
        const p = Promise.resolve([row]);
        return Object.assign(p, { returning: () => p });
      },
    }),
    update: (_table: any) => ({
      set: (vals: any) => ({
        where: async (where: any) => {
          const f = parseWhere(where);
          const row = rsRows.find((r) => rowMatches(r, f));
          if (row) Object.assign(row, vals);
        },
      }),
    }),
    delete: (_table: any) => ({
      where: async (where: any) => {
        const f = parseWhere(where);
        const idx = rsRows.findIndex((r) => rowMatches(r, f));
        if (idx !== -1) rsRows.splice(idx, 1);
      },
    }),
    select: (_shape: any) => ({
      from: (_table: any) => ({
        innerJoin: (_joinTable: any, _on: any) => ({
          where: async (where: any) => {
            const f = parseWhere(where);
            const filtered = rsRows.filter((r) => rowMatches(r, f));
            return filtered.map((rsRow) => {
              const speaker = speakersRows.find((s) => s.id === rsRow.speakerId);
              return { label: rsRow.label, name: speaker?.name ?? null };
            });
          },
        }),
      }),
    }),
  },
}));

beforeEach(() => {
  speakersRows.length = 0;
  rsRows.length = 0;
});

describe("speakers store", () => {
  it("findOrCreateSpeaker: dedupes case-insensitively and preserves original casing", async () => {
    const { findOrCreateSpeaker } = await import("./store");
    const r1 = await findOrCreateSpeaker("Bjorn");
    const r2 = await findOrCreateSpeaker(" bjorn ");
    expect(r1.id).toBe(r2.id);
    expect(r1.name).toBe("Bjorn"); // original casing preserved
    expect(r2.name).toBe("Bjorn"); // same stored casing returned for variant
    expect(speakersRows).toHaveLength(1);
  });

  it("findOrCreateSpeaker: trims whitespace before storing", async () => {
    const { findOrCreateSpeaker } = await import("./store");
    const r1 = await findOrCreateSpeaker("  Bob  ");
    const r2 = await findOrCreateSpeaker("bob");
    expect(r1.id).toBe(r2.id);
    expect(r1.name).toBe("Bob"); // trimmed, original casing preserved from first entry
  });

  it("setRecordingSpeaker: upserts a (recordingId, label) mapping", async () => {
    const { setRecordingSpeaker } = await import("./store");
    await setRecordingSpeaker("rec1", "A", "Alice");
    expect(rsRows).toHaveLength(1);
    expect(rsRows[0].label).toBe("A");

    // Update same (recordingId, label) with a different speaker
    await setRecordingSpeaker("rec1", "A", "Bob");
    expect(rsRows).toHaveLength(1); // still one row — updated in place
    const bobSpeaker = speakersRows.find((s) => s.name === "Bob");
    expect(rsRows[0].speakerId).toBe(bobSpeaker?.id);
  });

  it("setRecordingSpeaker: blank name deletes the mapping", async () => {
    const { setRecordingSpeaker } = await import("./store");
    await setRecordingSpeaker("rec1", "A", "Alice");
    expect(rsRows).toHaveLength(1);
    await setRecordingSpeaker("rec1", "A", "  ");
    expect(rsRows).toHaveLength(0);
  });

  it("getRecordingSpeakerMap: returns { label: name } for a recording", async () => {
    const { setRecordingSpeaker, getRecordingSpeakerMap } = await import("./store");
    await setRecordingSpeaker("rec1", "Speaker 1", "Alice");
    await setRecordingSpeaker("rec1", "Speaker 2", "Bob");
    const map = await getRecordingSpeakerMap("rec1");
    expect(map).toEqual({ "Speaker 1": "Alice", "Speaker 2": "Bob" });
  });

  it("getRecordingSpeakerMap: returns empty object when no mappings exist", async () => {
    const { getRecordingSpeakerMap } = await import("./store");
    const map = await getRecordingSpeakerMap("rec-none");
    expect(map).toEqual({});
  });

  it("listSpeakers: returns all speakers", async () => {
    const { findOrCreateSpeaker, listSpeakers } = await import("./store");
    await findOrCreateSpeaker("Alice");
    await findOrCreateSpeaker("Bob");
    const list = await listSpeakers();
    expect(list).toHaveLength(2);
    expect(list.map((s) => s.name).sort()).toEqual(["Alice", "Bob"]);
  });
});
