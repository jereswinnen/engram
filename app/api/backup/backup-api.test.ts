import { describe, it, expect, vi } from "vitest";
vi.mock("@/auth", () => ({ auth: { api: { getSession: vi.fn(async () => ({ user: { id: "u" } })) } } }));
vi.mock("@/lib/backup/store", () => ({
  createBackup: vi.fn(async () => ({ id: "b1", status: "pending" })),
  getBackups: vi.fn(async () => []),
  markError: vi.fn(async () => {}),
}));
vi.mock("@/lib/backup/build", () => ({ buildBackup: vi.fn(async () => {}) }));

describe("POST /api/backup", () => {
  it("creates a backup and returns its id", async () => {
    const { POST } = await import("./route");
    const res = await POST(new Request("http://localhost/api/backup", { method: "POST" }) as any);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: "b1" });
  });
});
