export function parseEntryInput(body: any): { term: string; aliases: string[] } | null {
  const term = typeof body?.term === "string" ? body.term.trim() : "";
  if (!term) return null;
  const aliases = Array.isArray(body?.aliases)
    ? body.aliases.map((a: unknown) => (typeof a === "string" ? a.trim() : "")).filter(Boolean)
    : [];
  return { term, aliases };
}
