import { describe, it, expect, afterEach } from "vitest";
import { config } from "./config";

afterEach(() => { delete process.env.PLAUD_API_BASE; delete process.env.NEXT_PUBLIC_APP_URL; });

describe("config additions", () => {
  it("plaudApiBase defaults to api.plaud.ai", () => {
    expect(config.plaudApiBase()).toBe("https://api.plaud.ai");
  });
  it("plaudApiBase honors override", () => {
    process.env.PLAUD_API_BASE = "https://api.eu.plaud.ai";
    expect(config.plaudApiBase()).toBe("https://api.eu.plaud.ai");
  });
});

describe("plaudRedirectUrl", () => {
  it("derives the callback URL from NEXT_PUBLIC_APP_URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://engram.example";
    expect(config.plaudRedirectUrl()).toBe("https://engram.example/api/plaud/callback");
  });
});
