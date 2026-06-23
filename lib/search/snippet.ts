// Control-char sentinels: never appear in transcript text, not HTML-special.
export const SNIPPET_START = "";
export const SNIPPET_END = "";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape the raw ts_headline output, then turn sentinels into <mark>. */
export function renderSnippet(raw: string): string {
  return escapeHtml(raw).split(SNIPPET_START).join("<mark>").split(SNIPPET_END).join("</mark>");
}
