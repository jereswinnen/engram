import { describe, it, expect, beforeAll } from "vitest";
import { encryptSecret, decryptSecret } from "./secrets";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = "0".repeat(64); // 32 bytes hex
});

describe("secrets", () => {
  it("round-trips a value", () => {
    const enc = encryptSecret("plaud-token-123");
    expect(enc).not.toContain("plaud-token-123");
    expect(decryptSecret(enc)).toBe("plaud-token-123");
  });

  it("produces distinct ciphertext each call (random IV)", () => {
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
  });

  it("rejects tampered payloads", () => {
    const enc = encryptSecret("secret");
    const tampered = enc.slice(0, -2) + (enc.endsWith("00") ? "ff" : "00");
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
