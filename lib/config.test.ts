import { describe, it, expect, afterEach } from "vitest";
import { config } from "./config";

afterEach(() => { delete process.env.NEXT_PUBLIC_APP_URL; });

describe("plaudRedirectUrl", () => {
  it("derives the callback URL from NEXT_PUBLIC_APP_URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://engram.example";
    expect(config.plaudRedirectUrl()).toBe("https://engram.example/api/plaud/callback");
  });
});
