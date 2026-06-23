export type GlossaryLike = { term: string; aliases: string[] };

const FORBIDDEN = /[<>{}[\]\\]/g;

function normalizeTerm(raw: string): string {
  return (raw ?? "").replace(FORBIDDEN, "").replace(/\s+/g, " ").trim();
}

export function toKeyterms(entries: GlossaryLike[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const term = normalizeTerm(e.term);
    if (!term || term.length > 50 || term.split(" ").length > 5) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= 1000) break;
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function applyAliasCorrections(text: string, entries: GlossaryLike[]): string {
  if (!text) return text;
  const pairs: { alias: string; canonical: string }[] = [];
  for (const e of entries) {
    const canonical = (e.term ?? "").trim();
    if (!canonical) continue;
    for (const a of e.aliases ?? []) {
      const alias = (a ?? "").trim();
      if (alias && alias.toLowerCase() !== canonical.toLowerCase()) pairs.push({ alias, canonical });
    }
  }
  // longer aliases first so a longer match isn't pre-empted by a shorter overlapping one
  pairs.sort((a, b) => b.alias.length - a.alias.length);
  let result = text;
  for (const { alias, canonical } of pairs) {
    const re = new RegExp(`\\b${escapeRegExp(alias)}\\b`, "gi");
    result = result.replace(re, canonical);
  }
  return result;
}

export function glossaryPromptBlock(entries: GlossaryLike[]): string {
  const terms = entries.map((e) => (e.term ?? "").trim()).filter(Boolean);
  if (terms.length === 0) return "";
  return `Gebruik de correcte spelling voor deze termen/namen: ${terms.join(", ")}.`;
}
