import { describe, it, expect, afterEach } from "vitest";
import { config } from "./config";

afterEach(() => { delete process.env.PLAUD_API_BASE; });

describe("config additions", () => {
  it("plaudApiBase defaults to api.plaud.ai", () => {
    expect(config.plaudApiBase()).toBe("https://api.plaud.ai");
  });
  it("plaudApiBase honors override", () => {
    process.env.PLAUD_API_BASE = "https://api.eu.plaud.ai";
    expect(config.plaudApiBase()).toBe("https://api.eu.plaud.ai");
  });
  it("cronSecret throws when unset", () => {
    delete process.env.CRON_SECRET;
    expect(() => config.cronSecret()).toThrow(/CRON_SECRET/);
  });
});
