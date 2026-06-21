import { describe, it, expect } from "vitest";
import { aliasOk } from "@/lib/__alias_check__";

describe("@/ path alias resolution", () => {
  it("should resolve @/ imports correctly via vite-tsconfig-paths", () => {
    expect(aliasOk).toBe(true);
  });
});
