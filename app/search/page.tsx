import Link from "next/link"
import { requireSession } from "@/lib/auth-guard"
import { searchRecordings } from "@/lib/search/search"
import { SearchBox } from "./search-box"
import { RiSearchAiLine, RiSparkling2Line, RiTimeLine } from "@remixicon/react"

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60)
  return `${minutes}:${remainder.toString().padStart(2, "0")}`
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const session = await requireSession()
  const { q = "" } = await searchParams
  const query = q.trim()
  const page = query
    ? await searchRecordings(session.user.id, query, { limit: 50 })
    : { results: [], pagination: { limit: 50, offset: 0, hasMore: false } }
  const recordings = Array.from(
    page.results
      .reduce((groups, hit) => {
        const group = groups.get(hit.recordingId)
        if (group) group.passages.push(hit)
        else groups.set(hit.recordingId, { hit, passages: [hit] })
        return groups
      }, new Map<string, { hit: (typeof page.results)[number]; passages: typeof page.results }>())
      .values()
  )

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 lg:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-[-0.02em]">Search</h1>
        <p className="text-sm text-muted-foreground">
          Search by exact words or describe what was discussed.
        </p>
      </div>
      <SearchBox initialQuery={q} />

      {query && page.results.length === 0 && (
        <div className="grid min-h-48 place-items-center rounded-xl border border-dashed text-center">
          <div>
            <RiSearchAiLine className="mx-auto mb-2 size-6 text-muted-foreground" />
            <p className="text-sm font-medium">No matches</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Try a broader phrase or a different topic.
            </p>
          </div>
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {recordings.map(({ hit, passages }) => (
          <li
            key={hit.recordingId}
            className="overflow-hidden rounded-xl border bg-card"
          >
            <Link
              href={`/recordings/${hit.recordingId}`}
              className="block border-b px-4 py-3 transition-colors hover:bg-muted/40"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{hit.title}</span>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {new Date(hit.createdAt).toLocaleDateString("en-GB")}
              </div>
            </Link>
            <ul className="divide-y">
              {passages.slice(0, 3).map((passage) => (
                <li key={passage.passageId}>
                  <Link
                    href={`/recordings/${passage.recordingId}?q=${encodeURIComponent(query)}${
                      passage.startSeconds === null
                        ? ""
                        : `&t=${passage.startSeconds}`
                    }`}
                    className="group block px-4 py-3 transition-colors hover:bg-muted/35"
                  >
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground group-hover:text-foreground">
                      {passage.startSeconds !== null && (
                        <span className="inline-flex items-center gap-1 tabular-nums">
                          <RiTimeLine className="size-3" />
                          {formatTime(passage.startSeconds)}
                        </span>
                      )}
                      {passage.matchType !== "keyword" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/8 px-2 py-0.5 text-[11px] text-primary">
                          <RiSparkling2Line className="size-3" />
                          {passage.matchType === "hybrid"
                            ? "Strong match"
                            : "Related meaning"}
                        </span>
                      )}
                    </div>
                    <p
                      className="text-sm text-muted-foreground group-hover:text-foreground [&_mark]:bg-yellow-500/30 [&_mark]:text-foreground"
                      dangerouslySetInnerHTML={{ __html: passage.snippet }}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}
