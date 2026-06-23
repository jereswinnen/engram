import { eq, desc } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/db";
import { recordings, transcriptions, aiEnhancements } from "@/db/schema";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import RetryButton from "./retry-button";
import { requireSession } from "@/lib/auth-guard";
import { TranscriptPlayer } from "./transcript-player";
import { ExportButtons } from "./export-buttons";
import { getRecordingSpeakerMap, listSpeakers } from "@/lib/speakers/store";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="font-medium">{title}</h3>
      {children}
    </div>
  );
}

export default async function RecordingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  await requireSession();

  const { id } = await params;
  const { q } = await searchParams;

  const [recording, transcription, enhancement, speakerMap, speakerDirectory] = await Promise.all([
    db.query.recordings.findFirst({ where: eq(recordings.id, id) }),
    db.query.transcriptions.findFirst({
      where: eq(transcriptions.recordingId, id),
      orderBy: [desc(transcriptions.createdAt)],
    }),
    db.query.aiEnhancements.findFirst({
      where: eq(aiEnhancements.recordingId, id),
      orderBy: [desc(aiEnhancements.createdAt)],
    }),
    getRecordingSpeakerMap(id),
    listSpeakers(),
  ]);

  if (!recording) notFound();

  const isDone = recording.status === "done";
  const isError = recording.status === "error";

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 flex flex-col gap-6">
      <Link
        href="/"
        className="text-sm text-muted-foreground hover:underline self-start"
      >
        ← Recordings
      </Link>

      <h1 className="text-xl font-semibold">{recording.title}</h1>

      <ExportButtons id={id} />

      {/* Waveform player + transcript */}
      <TranscriptPlayer
        audioSrc={`/api/recordings/${id}/audio`}
        segments={transcription?.segments ?? []}
        highlightQuery={q}
        chapters={enhancement?.chapters ?? []}
        speakerMap={speakerMap}
        directory={speakerDirectory.map((s) => s.name)}
        recordingId={id}
      />

      {/* Error state */}
      {isError && (
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Error</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-destructive">
              {recording.errorMessage ?? "Unknown error"}
            </p>
            <RetryButton recordingId={id} />
          </CardContent>
        </Card>
      )}

      {/* Summary card */}
      <Card>
        <CardHeader>
          <CardTitle>
            {isDone && enhancement?.title ? enhancement.title : "Summary"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isDone && enhancement ? (
            <div className="flex flex-col gap-4 text-sm">
              <p>{enhancement.overview}</p>

              {enhancement.keyPoints.length > 0 && (
                <Section title="Key points">
                  <ul className="list-disc pl-5">
                    {enhancement.keyPoints.map((p, i) => <li key={i}>{p}</li>)}
                  </ul>
                </Section>
              )}
              {enhancement.decisions.length > 0 && (
                <Section title="Decisions">
                  <ul className="list-disc pl-5">
                    {enhancement.decisions.map((d, i) => <li key={i}>{d}</li>)}
                  </ul>
                </Section>
              )}
              {enhancement.actionItems.length > 0 && (
                <Section title="Action items">
                  <ul className="flex flex-col gap-1">
                    {enhancement.actionItems.map((a, i) => (
                      <li key={i}>
                        {a.owner && <span className="font-medium">{a.owner}: </span>}{a.text}
                        {a.due && <span className="text-muted-foreground"> (due {a.due})</span>}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              {enhancement.openQuestions.length > 0 && (
                <Section title="Open questions">
                  <ul className="list-disc pl-5">
                    {enhancement.openQuestions.map((q, i) => <li key={i}>{q}</li>)}
                  </ul>
                </Section>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">processing…</p>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
