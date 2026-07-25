import Link from "next/link"
import { requireSession } from "@/lib/auth-guard"
import { searchRecordings } from "@/lib/search/search"
import { SearchBox } from "./search-box"

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
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Search</h1>
        <p className="text-sm text-muted-foreground">
          Search by exact words or describe what was discussed.
        </p>
      </div>
      <SearchBox initialQuery={q} />

      {query && page.results.length === 0 && (
        <p className="text-sm text-muted-foreground">No matches.</p>
      )}

      <ul className="flex flex-col gap-6">
        {recordings.map(({ hit, passages }) => (
          <li key={hit.recordingId} className="flex flex-col gap-2">
            <Link
              href={`/recordings/${hit.recordingId}`}
              className="hover:underline"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{hit.title}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {new Date(hit.createdAt).toLocaleDateString("en-GB")}
              </div>
            </Link>
            <ul className="flex flex-col gap-2 border-l pl-3">
              {passages.slice(0, 3).map((passage) => (
                <li key={passage.passageId}>
                  <Link
                    href={`/recordings/${passage.recordingId}?q=${encodeURIComponent(query)}${
                      passage.startSeconds === null
                        ? ""
                        : `&t=${passage.startSeconds}`
                    }`}
                    className="group block"
                  >
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground group-hover:text-foreground">
                      {passage.startSeconds !== null && (
                        <span>{formatTime(passage.startSeconds)}</span>
                      )}
                      {passage.matchType !== "keyword" && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
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
