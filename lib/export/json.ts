interface Rec { id: string; title: string; source: string; createdAt: Date; durationSeconds: number | null; status: string }
interface Tr { language: string | null; fullText: string; segments: { start: number; end: number; text: string; speaker?: string }[] }
interface Enh { title: string | null; overview: string; actionItems: { text: string; owner?: string; due?: string }[]; keyPoints: string[] }

export interface ExportRecord {
  id: string;
  title: string;
  source: string;
  createdAt: string;
  durationSeconds: number | null;
  status: string;
  transcript: { language: string | null; fullText: string; segments: Tr["segments"] } | null;
  enhancement: { title: string | null; overview: string; actionItems: { text: string; owner?: string; due?: string }[]; keyPoints: string[] } | null;
}

export function recordingToExport(rec: Rec, tr: Tr | null, enh: Enh | null): ExportRecord {
  return {
    id: rec.id,
    title: rec.title,
    source: rec.source,
    createdAt: rec.createdAt.toISOString(),
    durationSeconds: rec.durationSeconds,
    status: rec.status,
    transcript: tr ? { language: tr.language, fullText: tr.fullText, segments: tr.segments } : null,
    enhancement: enh ? { title: enh.title, overview: enh.overview, actionItems: enh.actionItems, keyPoints: enh.keyPoints } : null,
  };
}
