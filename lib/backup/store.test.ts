import { describe, it, expect, beforeEach, vi } from "vitest";
const rows: any[] = [];
vi.mock("@/db", () => ({
  db: {
    query: { backups: { findMany: async () => rows.slice().reverse() } },
    insert: () => ({ values: () => ({ returning: async () => { const r = { id: `b${rows.length}`, status: "pending", storageKey: null, sizeBytes: null, error: null, createdAt: new Date() }; rows.push(r); return [r]; } }) }),
    update: () => ({ set: (v: any) => ({ where: async () => { Object.assign(rows[rows.length - 1], v); } }) }),
  },
}));
beforeEach(() => { rows.length = 0; });

describe("backup store", () => {
  it("creates a pending backup", async () => {
    const { createBackup } = await import("./store");
    const b = await createBackup();
    expect(b.status).toBe("pending");
  });
  it("markReady sets status/key/size; markError sets error", async () => {
    const { createBackup, markReady, getBackups } = await import("./store");
    const b = await createBackup();
    await markReady(b.id, "backups/x.zip", 123);
    const all = await getBackups();
    expect(all[0]).toMatchObject({ status: "ready", storageKey: "backups/x.zip", sizeBytes: 123 });
  });
});
