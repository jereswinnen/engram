import Link from "next/link"
import { notFound } from "next/navigation"
import {
  RiArrowLeftLine,
  RiCalendarLine,
  RiCheckboxBlankCircleLine,
  RiCheckboxBlankCircleFill,
  RiCheckboxCircleLine,
  RiArrowDownSLine,
  RiFileTextLine,
  RiListCheck,
  RiListUnordered,
  RiMicLine,
  RiQuestionLine,
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
    <details open className="group border-b last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center gap-2 py-3 text-[13px] font-medium marker:hidden">
        <Icon className="size-4 text-muted-foreground" />
        <span>{title}</span>
        <RiArrowDownSLine className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="pb-4">{children}</div>
    </details>
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
    <div className="min-h-[calc(100vh-3rem)] xl:h-screen xl:min-h-0 xl:overflow-hidden">
      <div className="grid min-h-full xl:h-full xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col xl:h-full xl:min-h-0">
          <header className="border-b px-4 py-4 sm:px-6 xl:px-8 xl:pt-6 xl:pb-5">
            <Link
              href="/"
              className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground xl:hidden"
            >
              <RiArrowLeftLine className="size-3.5" />
              Library
            </Link>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <h1 className="max-w-3xl text-xl font-semibold tracking-[-0.035em] sm:text-[1.35rem] sm:leading-7">
                  {recording.title}
                </h1>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
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
                  <span className="inline-flex items-center gap-1 capitalize">
                    <RiCheckboxBlankCircleFill
                      className={
                        recording.status === "done"
                          ? "size-2 text-emerald-500"
                          : "size-2 text-amber-500"
                      }
                    />
                    {recording.status.replaceAll("_", " ")}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <ExportButtons id={id} />
                <DeleteRecordingButton recordingId={id} />
              </div>
            </div>
          </header>

          <main className="min-w-0 flex-1 px-4 py-4 sm:px-6 xl:min-h-0 xl:px-8 xl:pb-6">
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
        </div>

        <aside className="border-t bg-muted/15 px-4 py-2 sm:px-6 xl:h-full xl:overflow-y-auto xl:border-t-0 xl:border-l xl:px-5 xl:py-3">
          {isDone && enhancement ? (
            <div className="text-sm">
              <SummarySection title="Overview" icon={RiFileTextLine}>
                <p className="text-[13px] leading-5.5 text-muted-foreground">
                  {enhancement.overview}
                </p>
              </SummarySection>

              {enhancement.keyPoints.length > 0 && (
                <SummarySection title="Key points" icon={RiListUnordered}>
                  <ul className="space-y-2 pl-4 text-[13px] text-muted-foreground marker:text-border">
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
                  <ul className="space-y-2 pl-4 text-[13px] text-muted-foreground marker:text-border">
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
                  <div className="divide-y rounded-lg border bg-background/70">
                    {enhancement.actionItems.map((item, index) => (
                      <div
                        key={index}
                        className="grid grid-cols-[1rem_minmax(0,1fr)] gap-2.5 px-2.5 py-2.5"
                      >
                        <RiCheckboxBlankCircleLine className="mt-0.5 size-3.5 text-muted-foreground" />
                        <span className="min-w-0 text-[12px] leading-4.5">
                          <span className="block">{item.text}</span>
                          {item.owner && (
                            <span className="mt-1 inline-block text-[10px] text-muted-foreground">
                              {item.owner}
                            </span>
                          )}
                          {item.due && (
                            <span className="mt-1 ml-2 inline-block text-[10px] text-muted-foreground">
                              {item.due}
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </SummarySection>
              )}

              {enhancement.openQuestions.length > 0 && (
                <SummarySection title="Open questions" icon={RiQuestionLine}>
                  <ul className="space-y-2 pl-4 text-[13px] text-muted-foreground marker:text-border">
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
            <div className="my-3 rounded-xl border border-dashed bg-background/50 p-4">
              <p className="text-sm font-medium">Insights are processing</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                The overview, decisions, action items, and title will appear
                here.
              </p>
            </div>
          )}
          {transcription && (
            <div className="py-3">
              <RegenerateButton recordingId={id} />
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
