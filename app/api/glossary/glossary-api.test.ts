import { describe, it, expect } from "vitest";
import { parseEntryInput } from "./utils";

describe("parseEntryInput", () => {
  it("accepts a term + aliases", () => {
    expect(parseEntryInput({ term: " Riffado ", aliases: ["Rifado", " "] })).toEqual({ term: "Riffado", aliases: ["Rifado"] });
  });
  it("defaults aliases to []", () => {
    expect(parseEntryInput({ term: "Engram" })).toEqual({ term: "Engram", aliases: [] });
  });
  it("rejects empty/missing term", () => {
    expect(parseEntryInput({ aliases: ["x"] })).toBeNull();
    expect(parseEntryInput({ term: "   " })).toBeNull();
  });
});
