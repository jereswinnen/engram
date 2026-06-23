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

export interface ExportRecord {
  id: string;
  title: string;
  source: string;
  createdAt: string;
  durationSeconds: number | null;
  status: string;
  transcript: {
    language: string | null;
    fullText: string;
    segments: { start: number; end: number; text: string; speaker?: string }[];
  } | null;
  enhancement: {
    title: string | null;
    overview: string;
    actionItems: { text: string; owner?: string; due?: string }[];
    keyPoints: string[];
    decisions: string[];
    chapters: { title: string; gist: string; startSeconds?: number }[];
    openQuestions: string[];
  } | null;
}

export function recordingToExport(
  rec: Rec,
  tr: Tr | null,
  enh: Enh | null,
  speakerMap: Record<string, string> = {},
): ExportRecord {
  return {
    id: rec.id,
    title: rec.title,
    source: rec.source,
    createdAt: rec.createdAt.toISOString(),
    durationSeconds: rec.durationSeconds,
    status: rec.status,
    transcript: tr
      ? {
          language: tr.language,
          fullText: tr.fullText,
          segments: tr.segments.map((s) => ({
            ...s,
            speaker: s.speaker != null ? nameForLabel(s.speaker, speakerMap) : undefined,
          })),
        }
      : null,
    enhancement: enh
      ? {
          title: enh.title,
          overview: enh.overview,
          actionItems: enh.actionItems,
          keyPoints: enh.keyPoints,
          decisions: enh.decisions,
          chapters: enh.chapters,
          openQuestions: enh.openQuestions,
        }
      : null,
  };
}
