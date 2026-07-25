import Link from "next/link"
import {
  RiArrowRightSLine,
  RiArchiveLine,
  RiMicLine,
  RiMore2Line,
  RiTimeLine,
} from "@remixicon/react"
import { requireSession } from "@/lib/auth-guard"
import { listOwnedRecordings } from "@/lib/recordings/store"

function duration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`
}

export default async function HomePage() {
  const session = await requireSession()
  const recs = await listOwnedRecordings(session.user.id)

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="mb-6 flex items-end justify-between gap-4 border-b pb-5">
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            Your workspace
          </p>
          <h1 className="text-2xl font-semibold tracking-[-0.035em]">
            Library
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {recs.length} {recs.length === 1 ? "recording" : "recordings"}
          </p>
        </div>
      </header>

      {recs.length === 0 ? (
        <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed bg-card p-6 text-center">
          <div>
            <span className="mx-auto mb-4 grid size-10 place-items-center rounded-xl bg-muted">
              <RiArchiveLine className="size-5 text-muted-foreground" />
            </span>
            <p className="font-medium">No recordings yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Record from the Mac app to add your first recording.
            </p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.025)]">
          <div className="hidden grid-cols-[minmax(0,1fr)_9rem_7rem_2rem] gap-4 border-b bg-muted/35 px-4 py-2 text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase sm:grid">
            <span>Recording</span>
            <span>Date</span>
            <span>Duration</span>
            <span className="sr-only">Open</span>
          </div>
          {recs.map((rec) => (
            <Link
              key={rec.id}
              href={`/recordings/${rec.id}`}
              className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b px-3 py-3 transition-colors last:border-b-0 hover:bg-muted/40 sm:grid-cols-[minmax(0,1fr)_9rem_7rem_2rem] sm:gap-4 sm:px-4"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium tracking-[-0.01em]">
                  {rec.title}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground sm:hidden">
                  <RiMicLine className="size-3" />
                  <span className="capitalize">{rec.source}</span>
                  <span aria-hidden>·</span>
                  <span>
                    {new Date(rec.createdAt).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </span>
              </span>
              <span className="hidden text-xs text-muted-foreground sm:block">
                {new Date(rec.createdAt).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
              <span className="hidden items-center gap-1.5 text-xs text-muted-foreground tabular-nums sm:flex">
                <RiTimeLine className="size-3.5" />
                {rec.durationSeconds != null
                  ? duration(rec.durationSeconds)
                  : "—"}
              </span>
              <span className="flex items-center justify-end">
                <RiArrowRightSLine className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground sm:hidden" />
                <RiMore2Line className="hidden size-4 text-muted-foreground group-hover:text-foreground sm:block" />
              </span>
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}
