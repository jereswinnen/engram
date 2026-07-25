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
  const results = query ? await searchRecordings(session.user.id, query) : []

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Search</h1>
        <p className="text-sm text-muted-foreground">
          Search by exact words or describe what was discussed.
        </p>
      </div>
      <SearchBox initialQuery={q} />

      {query && results.length === 0 && (
        <p className="text-sm text-muted-foreground">No matches.</p>
      )}

      <ul className="flex flex-col gap-4">
        {results.map((hit) => (
          <li key={hit.id}>
            <Link
              href={`/recordings/${hit.id}?q=${encodeURIComponent(query)}${
                hit.startSeconds === null ? "" : `&t=${hit.startSeconds}`
              }`}
              className="block hover:underline"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{hit.title}</span>
                {hit.matchType === "semantic" && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    Related meaning
                  </span>
                )}
              </div>
              <div className="flex gap-2 text-xs text-muted-foreground">
                {new Date(hit.createdAt).toLocaleDateString("en-GB")}
                {hit.startSeconds !== null && (
                  <span>{formatTime(hit.startSeconds)}</span>
                )}
              </div>
            </Link>
            <p
              className="mt-1 text-sm text-muted-foreground [&_mark]:bg-yellow-500/30 [&_mark]:text-foreground"
              dangerouslySetInnerHTML={{ __html: hit.snippet }}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
