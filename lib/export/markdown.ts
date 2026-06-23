interface Rec { id: string; title: string; source: string; createdAt: Date; durationSeconds: number | null; status: string }
interface Tr { language: string | null; fullText: string; segments: { start: number; end: number; text: string; speaker?: string }[] }
interface Enh { title: string | null; summary: string; actionItems: string[]; keyPoints: string[] }

function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function recordingToMarkdown(rec: Rec, tr: Tr | null, enh: Enh | null): string {
  const lines: string[] = [];
  lines.push(`# ${rec.title}`, "");
  const dur = rec.durationSeconds != null ? ` · ${mmss(rec.durationSeconds)}` : "";
  lines.push(`_${rec.createdAt.toISOString().slice(0, 10)} · source: ${rec.source}${dur}_`, "");

  lines.push("## Summary", "");
  lines.push(enh ? enh.summary : "_Not yet processed_", "");
  if (enh && enh.actionItems.length > 0) {
    lines.push("## Action items", "", ...enh.actionItems.map((i) => `- ${i}`), "");
  }
  if (enh && enh.keyPoints.length > 0) {
    lines.push("## Key points", "", ...enh.keyPoints.map((p) => `- ${p}`), "");
  }

  lines.push("## Transcript", "");
  if (tr && tr.segments.length > 0) {
    for (const s of tr.segments) {
      lines.push(`**Speaker ${s.speaker ?? "?"}** [${mmss(s.start)}]: ${s.text}`, "");
    }
  } else {
    lines.push("_No transcript yet_", "");
  }
  return lines.join("\n");
}
