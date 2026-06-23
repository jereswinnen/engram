export function exportFilename(title: string, id: string, ext: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || id}.${ext}`;
}
