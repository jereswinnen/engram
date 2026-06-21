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

export default async function RecordingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [recording, transcription, enhancement] = await Promise.all([
    db.query.recordings.findFirst({ where: eq(recordings.id, id) }),
    db.query.transcriptions.findFirst({
      where: eq(transcriptions.recordingId, id),
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
        ← Opnames
      </Link>

      <h1 className="text-xl font-semibold">{recording.title}</h1>

      {/* Audio player */}
      <audio controls src={`/api/recordings/${id}/audio`} className="w-full" />

      {/* Error state */}
      {isError && (
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Fout</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-destructive">
              {recording.errorMessage ?? "Onbekende fout"}
            </p>
            <RetryButton recordingId={id} />
          </CardContent>
        </Card>
      )}

      {/* Summary card */}
      <Card>
        <CardHeader>
          <CardTitle>
            {isDone && enhancement?.title ? enhancement.title : "Samenvatting"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isDone && enhancement ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm">{enhancement.summary}</p>
              {enhancement.actionItems.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1">Actiepunten</p>
                  <ul className="list-disc pl-4 text-sm flex flex-col gap-1">
                    {enhancement.actionItems.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {enhancement.keyPoints.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1">Kernpunten</p>
                  <ul className="list-disc pl-4 text-sm flex flex-col gap-1">
                    {enhancement.keyPoints.map((point, i) => (
                      <li key={i}>{point}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">in behandeling…</p>
          )}
        </CardContent>
      </Card>

      {/* Transcript */}
      {transcription && (
        <Card>
          <CardHeader>
            <CardTitle>Transcript</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2 text-sm font-mono">
              {transcription.segments.map((seg, i) => (
                <div key={i}>
                  <span className="text-muted-foreground text-xs">
                    {formatTime(seg.start)}
                  </span>{" "}
                  <span className="font-medium">
                    Speaker {seg.speaker ?? "?"}
                  </span>
                  {": "}
                  {seg.text}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
