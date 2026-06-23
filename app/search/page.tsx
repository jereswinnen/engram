import Link from "next/link";
import { requireSession } from "@/lib/auth-guard";
import { searchRecordings } from "@/lib/search/search";
import { SearchBox } from "./search-box";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireSession();
  const { q = "" } = await searchParams;
  const query = q.trim();
  const results = query ? await searchRecordings(query) : [];

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Search</h1>
      <SearchBox initialQuery={q} />

      {query && results.length === 0 && (
        <p className="text-sm text-muted-foreground">No matches.</p>
      )}

      <ul className="flex flex-col gap-4">
        {results.map((hit) => (
          <li key={hit.id}>
            <Link
              href={`/recordings/${hit.id}?q=${encodeURIComponent(query)}`}
              className="block hover:underline"
            >
              <div className="font-medium">{hit.title}</div>
              <div className="text-xs text-muted-foreground">
                {new Date(hit.createdAt).toLocaleDateString("en-GB")}
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
  );
}
