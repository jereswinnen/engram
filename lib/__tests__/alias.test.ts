import { describe, it, expect } from "vitest";
import { config } from "@/lib/config";

describe("@/ path alias resolution", () => {
  it("should resolve @/ imports correctly via vite-tsconfig-paths", () => {
    expect(config).toBeDefined();
    expect(typeof config).toBe("object");
  });
});
