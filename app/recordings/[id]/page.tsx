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
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 text-[13px] font-medium marker:hidden sm:px-5">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted/70 text-muted-foreground transition-colors group-hover:text-foreground">
          <Icon className="size-3.5" />
        </span>
        <span>{title}</span>
        <RiArrowDownSLine className="ml-auto size-4 text-muted-foreground/70 transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-4 pb-5 pl-14 sm:px-5 sm:pl-15">{children}</div>
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
    <div className="flex min-h-[calc(100vh-3rem)] flex-col xl:h-screen xl:min-h-0 xl:overflow-hidden">
      <header className="shrink-0 border-b bg-background/95">
        <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 xl:px-10 xl:py-6 2xl:px-12">
          <Link
            href="/"
            className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground xl:hidden"
          >
            <RiArrowLeftLine className="size-3.5" />
            Library
          </Link>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
            <div className="min-w-0">
              <h1 className="max-w-4xl text-[1.35rem] font-semibold tracking-[-0.035em] text-balance sm:text-2xl sm:leading-8">
                {recording.title}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
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
        </div>
      </header>

      <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_minmax(29rem,43%)] 2xl:grid-cols-[minmax(0,1fr)_minmax(34rem,44rem)]">
        <main className="min-w-0 px-4 py-8 sm:px-6 sm:py-10 xl:overflow-y-auto xl:px-10 xl:py-11 2xl:px-12 2xl:py-12">
          <div className="mx-auto w-full max-w-3xl">
            <div className="mb-6 flex items-end justify-between gap-4 sm:mb-7">
              <div>
                <p className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
                  Recording notes
                </p>
                <h2 className="mt-1.5 text-lg font-semibold tracking-[-0.025em]">
                  What matters
                </h2>
              </div>
              {isDone && enhancement && (
                <p className="hidden text-xs text-muted-foreground sm:block">
                  {enhancement.keyPoints.length +
                    enhancement.decisions.length +
                    enhancement.actionItems.length}{" "}
                  takeaways
                </p>
              )}
            </div>
            {isDone && enhancement ? (
              <div className="space-y-4 text-sm">
                <section className="rounded-2xl border bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.025)] sm:p-6">
                  <div className="mb-3 flex items-center gap-2.5">
                    <span className="grid size-7 place-items-center rounded-lg bg-foreground text-background">
                      <RiFileTextLine className="size-3.5" />
                    </span>
                    <h3 className="text-[13px] font-medium">Overview</h3>
                  </div>
                  <p className="text-[14px] leading-6.5 text-foreground/75">
                    {enhancement.overview}
                  </p>
                </section>

                <div className="overflow-hidden rounded-2xl border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.025)]">
                  {enhancement.keyPoints.length > 0 && (
                    <SummarySection title="Key points" icon={RiListUnordered}>
                      <ul className="space-y-2.5 pl-4 text-[13px] text-foreground/70 marker:text-muted-foreground/40">
                        {enhancement.keyPoints.map((point, index) => (
                          <li
                            key={index}
                            className="list-disc pl-1 leading-5.5"
                          >
                            {point}
                          </li>
                        ))}
                      </ul>
                    </SummarySection>
                  )}

                  {enhancement.decisions.length > 0 && (
                    <SummarySection
                      title="Decisions"
                      icon={RiCheckboxCircleLine}
                    >
                      <ul className="space-y-2.5 pl-4 text-[13px] text-foreground/70 marker:text-muted-foreground/40">
                        {enhancement.decisions.map((decision, index) => (
                          <li
                            key={index}
                            className="list-disc pl-1 leading-5.5"
                          >
                            {decision}
                          </li>
                        ))}
                      </ul>
                    </SummarySection>
                  )}

                  {enhancement.actionItems.length > 0 && (
                    <SummarySection title="Action items" icon={RiListCheck}>
                      <div className="divide-y overflow-hidden rounded-xl border bg-muted/20">
                        {enhancement.actionItems.map((item, index) => (
                          <div
                            key={index}
                            className="grid grid-cols-[1rem_minmax(0,1fr)] gap-3 px-3.5 py-3"
                          >
                            <RiCheckboxBlankCircleLine className="mt-0.5 size-3.5 text-muted-foreground" />
                            <span className="min-w-0 text-[13px] leading-5">
                              <span className="block text-foreground/80">
                                {item.text}
                              </span>
                              {(item.owner || item.due) && (
                                <span className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] font-medium tracking-[0.04em] text-muted-foreground uppercase">
                                  {item.owner && <span>{item.owner}</span>}
                                  {item.due && <span>{item.due}</span>}
                                </span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </SummarySection>
                  )}

                  {enhancement.openQuestions.length > 0 && (
                    <SummarySection
                      title="Open questions"
                      icon={RiQuestionLine}
                    >
                      <ul className="space-y-2.5 pl-4 text-[13px] text-foreground/70 marker:text-muted-foreground/40">
                        {enhancement.openQuestions.map((question, index) => (
                          <li
                            key={index}
                            className="list-disc pl-1 leading-5.5"
                          >
                            {question}
                          </li>
                        ))}
                      </ul>
                    </SummarySection>
                  )}
                </div>
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

            {isError && (
              <Card className="mt-6" size="sm">
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

            {transcription && (
              <div className="pt-5">
                <RegenerateButton recordingId={id} />
              </div>
            )}
          </div>
        </main>

        <aside
          aria-label="Transcript"
          className="min-w-0 border-t bg-muted/20 px-4 py-8 sm:px-6 sm:py-10 xl:min-h-0 xl:overflow-hidden xl:border-t-0 xl:border-l xl:px-7 xl:py-11 2xl:px-8 2xl:py-12"
        >
          <div className="flex h-full min-h-0 flex-col">
            <div className="mb-6 flex items-end justify-between gap-4 sm:mb-7">
              <div>
                <p className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
                  Full recording
                </p>
                <h2 className="mt-1.5 text-lg font-semibold tracking-[-0.025em]">
                  Transcript
                </h2>
              </div>
              {transcription && (
                <p className="text-xs text-muted-foreground tabular-nums">
                  {transcription.segments.length} segments
                </p>
              )}
            </div>
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
          </div>
        </aside>
      </div>
    </div>
  )
}
