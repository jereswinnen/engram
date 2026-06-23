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

export default async function RecordingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();

  const { id } = await params;

  const [recording, transcription, enhancement] = await Promise.all([
    db.query.recordings.findFirst({ where: eq(recordings.id, id) }),
    db.query.transcriptions.findFirst({
      where: eq(transcriptions.recordingId, id),
      orderBy: [desc(transcriptions.createdAt)],
    }),
    db.query.aiEnhancements.findFirst({
      where: eq(aiEnhancements.recordingId, id),
      orderBy: [desc(aiEnhancements.createdAt)],
    }),
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

      {/* Waveform player + transcript */}
      <TranscriptPlayer
        audioSrc={`/api/recordings/${id}/audio`}
        segments={transcription?.segments ?? []}
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
            <div className="flex flex-col gap-4">
              <p className="text-sm">{enhancement.summary}</p>
              {enhancement.actionItems.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1">Action items</p>
                  <ul className="list-disc pl-4 text-sm flex flex-col gap-1">
                    {enhancement.actionItems.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {enhancement.keyPoints.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1">Key points</p>
                  <ul className="list-disc pl-4 text-sm flex flex-col gap-1">
                    {enhancement.keyPoints.map((point, i) => (
                      <li key={i}>{point}</li>
                    ))}
                  </ul>
                </div>
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
