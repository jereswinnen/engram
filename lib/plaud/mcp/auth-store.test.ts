import { describe, it, expect, beforeEach, vi } from "vitest";

// in-memory api_credentials backing the mocked db
const store: { row?: { provider: string; ciphertext: string } } = {};
vi.mock("@/db", () => ({
  db: {
    query: { apiCredentials: { findFirst: async () => store.row } },
    insert: () => ({ values: (v: any) => ({ onConflictDoUpdate: async ({ set }: any) => { store.row = { provider: v.provider, ciphertext: set.ciphertext }; } }) }),
    delete: () => ({ where: async () => { store.row = undefined; } }),
  },
}));

beforeEach(() => { store.row = undefined; process.env.ENCRYPTION_KEY = "0".repeat(64); });

describe("plaudAuthStore", () => {
  it("round-trips tokens / clientInfo / codeVerifier through encryption", async () => {
    const { plaudAuthStore } = await import("./auth-store");
    await plaudAuthStore.saveTokens({ access_token: "a", token_type: "bearer" } as any);
    await plaudAuthStore.saveClientInfo({ client_id: "c1" } as any);
    await plaudAuthStore.saveCodeVerifier("verifier-123");
    expect(store.row!.ciphertext).not.toContain("verifier-123"); // encrypted at rest
    expect((await plaudAuthStore.getTokens())?.access_token).toBe("a");
    expect((await plaudAuthStore.getClientInfo())?.client_id).toBe("c1");
    expect(await plaudAuthStore.getCodeVerifier()).toBe("verifier-123");
    expect(await plaudAuthStore.isConnected()).toBe(true);
  });
  it("isConnected is false with no tokens; clear() wipes state", async () => {
    const { plaudAuthStore } = await import("./auth-store");
    expect(await plaudAuthStore.isConnected()).toBe(false);
    await plaudAuthStore.saveCodeVerifier("v"); // state exists but no tokens
    expect(await plaudAuthStore.isConnected()).toBe(false);
    await plaudAuthStore.saveTokens({ access_token: "a", token_type: "bearer" } as any);
    expect(await plaudAuthStore.isConnected()).toBe(true);
    await plaudAuthStore.clear();
    expect(await plaudAuthStore.isConnected()).toBe(false);
    expect(store.row).toBeUndefined();
  });
});
