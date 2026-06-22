import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("@/lib/plaud/sync", () => ({ syncPlaud: vi.fn(async () => ({ ranAt: "x", newCount: 0, skippedCount: 0, failedCount: 0 })) }));

beforeEach(() => { process.env.CRON_SECRET = "s3cret"; });

function req(headers: Record<string, string>) {
  return new Request("http://localhost/api/sync", { method: "POST", headers });
}

describe("isAuthorized", () => {
  it("accepts a matching CRON_SECRET bearer without a session", async () => {
    const { isAuthorized } = await import("./route");
    expect(await isAuthorized(req({ authorization: "Bearer s3cret" }))).toBe(true);
  });
  it("rejects a wrong secret and no session", async () => {
    const { auth } = await import("@/auth");
    (auth.api.getSession as any).mockResolvedValueOnce(null);
    const { isAuthorized } = await import("./route");
    expect(await isAuthorized(req({ authorization: "Bearer wrong" }))).toBe(false);
  });
  it("accepts a valid session with no secret header", async () => {
    const { auth } = await import("@/auth");
    (auth.api.getSession as any).mockResolvedValueOnce({ user: { id: "u1" } });
    const { isAuthorized } = await import("./route");
    expect(await isAuthorized(req({}))).toBe(true);
  });
  it("rejects 'Bearer undefined' when CRON_SECRET is unset and no session", async () => {
    delete process.env.CRON_SECRET;
    const { auth } = await import("@/auth");
    (auth.api.getSession as any).mockResolvedValueOnce(null);
    const { isAuthorized } = await import("./route");
    expect(await isAuthorized(req({ authorization: "Bearer undefined" }))).toBe(false);
  });
});
