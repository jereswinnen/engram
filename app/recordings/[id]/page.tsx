import Link from "next/link"
import { notFound } from "next/navigation"
import {
  RiArrowLeftLine,
  RiCalendarLine,
  RiCheckboxCircleLine,
  RiFileTextLine,
  RiListCheck,
  RiMicLine,
  RiQuestionLine,
  RiSparkling2Line,
  RiTimeLine,
} from "@remixicon/react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import RetryButton from "./retry-button"
import RegenerateButton from "./regenerate-button"
import { requireSession } from "@/lib/auth-guard"
import { TranscriptPlayer } from "./transcript-player"
import { ExportButtons } from "./export-buttons"
import { DeleteRecordingButton } from "./delete-recording-button"
import { getRecordingSpeakerMap, listSpeakers } from "@/lib/speakers/store"
import { getOwnedRecordingBundle } from "@/lib/recordings/store"

function SummarySection({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon: typeof RiFileTextLine
  children: React.ReactNode
}) {
  return (
    <section className="border-t pt-4 first:border-t-0 first:pt-0">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Icon className="size-4 text-muted-foreground" />
        {title}
      </h2>
      {children}
    </section>
  )
}

function duration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`
}

export default async function RecordingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ q?: string; t?: string }>
}) {
  const session = await requireSession()
  const { id } = await params
  const { q, t } = await searchParams
  const requestedTime = t === undefined ? Number.NaN : Number(t)
  const initialTime =
    Number.isFinite(requestedTime) && requestedTime >= 0
      ? requestedTime
      : undefined

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
    <div className="mx-auto max-w-[1500px] px-4 py-5 lg:px-6">
      <Link
        href="/"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <RiArrowLeftLine className="size-4" />
        Library
      </Link>

      <header className="border-b pb-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-start gap-2">
              <h1 className="text-xl font-semibold tracking-[-0.025em] sm:text-2xl">
                {recording.title}
              </h1>
              {recording.titleOrigin === "generated" && (
                <span className="mt-1 inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/8 px-2 py-0.5 text-[11px] font-medium text-primary">
                  <RiSparkling2Line className="size-3" /> AI title
                </span>
              )}
            </div>
            {recording.titleOrigin === "generated" &&
              recording.originalTitle && (
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  Original: {recording.originalTitle}
                </p>
              )}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <RiCalendarLine className="size-3.5" />
                {new Date(recording.createdAt).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
              {recording.durationSeconds != null && (
                <span className="inline-flex items-center gap-1.5 tabular-nums">
                  <RiTimeLine className="size-3.5" />
                  {duration(recording.durationSeconds)}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 capitalize">
                <RiMicLine className="size-3.5" />
                {recording.source}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 capitalize">
                {recording.status.replaceAll("_", " ")}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <ExportButtons id={id} />
            <DeleteRecordingButton recordingId={id} />
          </div>
        </div>
      </header>

      <div className="grid min-w-0 xl:grid-cols-[minmax(0,1.65fr)_minmax(330px,0.85fr)]">
        <main className="min-w-0 py-5 xl:pr-6">
          <TranscriptPlayer
            audioSrc={`/api/recordings/${id}/audio`}
            segments={transcription?.segments ?? []}
            highlightQuery={q}
            initialTime={initialTime}
            chapters={enhancement?.chapters ?? []}
            speakerMap={speakerMap}
            directory={speakerDirectory.map((speaker) => speaker.name)}
            recordingId={id}
          />

          {isError && (
            <Card className="mt-5" size="sm">
              <CardHeader>
                <CardTitle className="text-destructive">
                  Processing error
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-sm text-destructive">
                  {recording.errorMessage ?? "Unknown error"}
                </p>
                <RetryButton recordingId={id} />
              </CardContent>
            </Card>
          )}
        </main>

        <aside className="border-t py-5 xl:border-t-0 xl:border-l xl:pl-6">
          {isDone && enhancement ? (
            <div className="flex flex-col gap-4 text-sm">
              <SummarySection title="Overview" icon={RiFileTextLine}>
                <p className="leading-6 text-muted-foreground">
                  {enhancement.overview}
                </p>
              </SummarySection>

              {enhancement.keyPoints.length > 0 && (
                <SummarySection title="Key points" icon={RiSparkling2Line}>
                  <ul className="space-y-1.5 pl-4 text-muted-foreground marker:text-border">
                    {enhancement.keyPoints.map((point, index) => (
                      <li key={index} className="list-disc pl-0.5 leading-5">
                        {point}
                      </li>
                    ))}
                  </ul>
                </SummarySection>
              )}

              {enhancement.decisions.length > 0 && (
                <SummarySection title="Decisions" icon={RiCheckboxCircleLine}>
                  <ul className="space-y-1.5 pl-4 text-muted-foreground marker:text-border">
                    {enhancement.decisions.map((decision, index) => (
                      <li key={index} className="list-disc pl-0.5 leading-5">
                        {decision}
                      </li>
                    ))}
                  </ul>
                </SummarySection>
              )}

              {enhancement.actionItems.length > 0 && (
                <SummarySection title="Action items" icon={RiListCheck}>
                  <div className="overflow-hidden rounded-lg border">
                    {enhancement.actionItems.map((item, index) => (
                      <div
                        key={index}
                        className="grid grid-cols-[1fr_auto] gap-3 border-b px-3 py-2.5 last:border-b-0"
                      >
                        <span className="leading-5">{item.text}</span>
                        <span className="text-right text-xs text-muted-foreground">
                          {item.owner && (
                            <span className="block">{item.owner}</span>
                          )}
                          {item.due && (
                            <span className="block">{item.due}</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </SummarySection>
              )}

              {enhancement.openQuestions.length > 0 && (
                <SummarySection title="Open questions" icon={RiQuestionLine}>
                  <ul className="space-y-1.5 pl-4 text-muted-foreground marker:text-border">
                    {enhancement.openQuestions.map((question, index) => (
                      <li key={index} className="list-disc pl-0.5 leading-5">
                        {question}
                      </li>
                    ))}
                  </ul>
                </SummarySection>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-4">
              <p className="text-sm font-medium">Engram AI is processing</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                The overview, decisions, action items, and title will appear
                here.
              </p>
            </div>
          )}
          {transcription && (
            <div className="mt-4 border-t pt-4">
              <RegenerateButton recordingId={id} />
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
