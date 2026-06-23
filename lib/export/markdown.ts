import { nameForLabel } from "@/lib/transcript/speaker-names";

interface Rec { id: string; title: string; source: string; createdAt: Date; durationSeconds: number | null; status: string }
interface Tr { language: string | null; fullText: string; segments: { start: number; end: number; text: string; speaker?: string }[] }
interface Enh {
  title: string | null;
  overview: string;
  actionItems: { text: string; owner?: string; due?: string }[];
  keyPoints: string[];
  decisions: string[];
  chapters: { title: string; gist: string; startSeconds?: number }[];
  openQuestions: string[];
}

function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function recordingToMarkdown(
  rec: Rec,
  tr: Tr | null,
  enh: Enh | null,
  speakerMap: Record<string, string> = {},
): string {
  const lines: string[] = [];
  lines.push(`# ${rec.title}`, "");
  const dur = rec.durationSeconds != null ? ` · ${mmss(rec.durationSeconds)}` : "";
  lines.push(`_${rec.createdAt.toISOString().slice(0, 10)} · source: ${rec.source}${dur}_`, "");

  lines.push("## Summary", "");
  lines.push(enh ? enh.overview : "_Not yet processed_", "");

  if (enh && enh.actionItems.length > 0) {
    lines.push("## Action items", "", ...enh.actionItems.map((i) => `- ${i.text}${i.owner ? ` (${i.owner})` : ""}${i.due ? ` — due ${i.due}` : ""}`), "");
  }
  if (enh && enh.keyPoints.length > 0) {
    lines.push("## Key points", "", ...enh.keyPoints.map((p) => `- ${p}`), "");
  }
  if (enh && enh.decisions.length > 0) {
    lines.push("## Decisions", "", ...enh.decisions.map((d) => `- ${d}`), "");
  }
  if (enh && enh.chapters.length > 0) {
    lines.push(
      "## Chapters",
      "",
      ...enh.chapters.map((c) => {
        const ts = c.startSeconds != null ? ` [${mmss(c.startSeconds)}]` : "";
        return `**${c.title}**${ts} — ${c.gist}`;
      }),
      "",
    );
  }
  if (enh && enh.openQuestions.length > 0) {
    lines.push("## Open questions", "", ...enh.openQuestions.map((q) => `- ${q}`), "");
  }

  lines.push("## Transcript", "");
  if (tr && tr.segments.length > 0) {
    for (const s of tr.segments) {
      const name = s.speaker != null ? nameForLabel(s.speaker, speakerMap) : "Speaker ?";
      lines.push(`**${name}** [${mmss(s.start)}]: ${s.text}`, "");
    }
  } else {
    lines.push("_No transcript yet_", "");
  }
  return lines.join("\n");
}
