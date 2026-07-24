import { notFound } from "next/navigation"
import Link from "next/link"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import RetryButton from "./retry-button"
import RegenerateButton from "./regenerate-button"
import { requireSession } from "@/lib/auth-guard"
import { TranscriptPlayer } from "./transcript-player"
import { ExportButtons } from "./export-buttons"
import { DeleteRecordingButton } from "./delete-recording-button"
import { getRecordingSpeakerMap, listSpeakers } from "@/lib/speakers/store"
import { getOwnedRecordingBundle } from "@/lib/recordings/store"

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="font-medium">{title}</h3>
      {children}
    </div>
  )
}

export default async function RecordingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ q?: string }>
}) {
  const session = await requireSession()

  const { id } = await params
  const { q } = await searchParams

  const [bundle, speakerMap, speakerDirectory] = await Promise.all([
    getOwnedRecordingBundle(session.user.id, id),
    getRecordingSpeakerMap(session.user.id, id),
    listSpeakers(session.user.id),
  ])

  if (!bundle) notFound()
  const { recording, transcription, enhancement } = bundle

  const isDone = recording.status === "done"
  const isError = recording.status === "error"

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <Link
        href="/"
        className="self-start text-sm text-muted-foreground hover:underline"
      >
        ← Recordings
      </Link>

      <h1 className="text-xl font-semibold">{recording.title}</h1>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ExportButtons id={id} />
        <DeleteRecordingButton recordingId={id} />
      </div>

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
                    {enhancement.keyPoints.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </Section>
              )}
              {enhancement.decisions.length > 0 && (
                <Section title="Decisions">
                  <ul className="list-disc pl-5">
                    {enhancement.decisions.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                </Section>
              )}
              {enhancement.actionItems.length > 0 && (
                <Section title="Action items">
                  <ul className="flex flex-col gap-1">
                    {enhancement.actionItems.map((a, i) => (
                      <li key={i}>
                        {a.owner && (
                          <span className="font-medium">{a.owner}: </span>
                        )}
                        {a.text}
                        {a.due && (
                          <span className="text-muted-foreground">
                            {" "}
                            (due {a.due})
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              {enhancement.openQuestions.length > 0 && (
                <Section title="Open questions">
                  <ul className="list-disc pl-5">
                    {enhancement.openQuestions.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </Section>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">processing…</p>
          )}
          {transcription && (
            <div className="mt-4 border-t pt-4">
              <RegenerateButton recordingId={id} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
