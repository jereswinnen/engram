import { describe, it, expect } from "vitest";
import { toKeyterms, applyAliasCorrections, glossaryPromptBlock } from "./apply";

const g = (term: string, aliases: string[] = []) => ({ term, aliases });

describe("toKeyterms", () => {
  it("returns sanitized, deduped canonical terms", () => {
    expect(toKeyterms([g("Riffado"), g("riffado"), g("Engram")])).toEqual(["Riffado", "Engram"]);
  });
  it("drops terms over 50 chars or over 5 words, and strips forbidden chars", () => {
    expect(toKeyterms([g("a".repeat(51))])).toEqual([]);
    expect(toKeyterms([g("one two three four five six")])).toEqual([]);
    expect(toKeyterms([g("Acme <Corp>")])).toEqual(["Acme Corp"]);
  });
  it("caps at 1000", () => {
    const many = Array.from({ length: 1100 }, (_, i) => g(`term${i}`));
    expect(toKeyterms(many)).toHaveLength(1000);
  });
});

describe("applyAliasCorrections", () => {
  it("replaces aliases with the canonical term, case-insensitive, canonical casing", () => {
    expect(applyAliasCorrections("rifado and Rifado rock", [g("Riffado", ["Rifado"])])).toBe("Riffado and Riffado rock");
  });
  it("respects word boundaries (no substring corruption)", () => {
    expect(applyAliasCorrections("let's meet again about AI", [g("AI Corp", ["AI"])])).toBe("let's meet again about AI Corp");
  });
  it("applies longer aliases before shorter to avoid partial overlap", () => {
    expect(applyAliasCorrections("Rifado", [g("Riffado", ["Rif", "Rifado"])])).toBe("Riffado");
  });
  it("is a no-op for an empty glossary", () => {
    expect(applyAliasCorrections("unchanged", [])).toBe("unchanged");
  });
  it("handles punctuated aliases with conditional word boundaries", () => {
    expect(applyAliasCorrections("We discussed A.I. today", [g("Artificial Intelligence", ["A.I."])])).toBe("We discussed Artificial Intelligence today");
  });
});

describe("glossaryPromptBlock", () => {
  it("returns empty string for empty glossary", () => {
    expect(glossaryPromptBlock([])).toBe("");
  });
  it("lists the canonical terms", () => {
    expect(glossaryPromptBlock([g("Riffado"), g("Engram")])).toContain("Riffado");
  });
  it("renders aliases with ook: prefix for entries that have them", () => {
    const result = glossaryPromptBlock([g("Riffado", ["Rifado", "Riffadoo"]), g("Engram")]);
    expect(result).toContain("Riffado (ook: Rifado, Riffadoo)");
    expect(result).toContain("Engram");
  });
  it("renders no-alias entries without parentheses", () => {
    expect(glossaryPromptBlock([g("Engram")])).toBe("Gebruik de correcte spelling voor deze termen/namen: Engram.");
  });
});
