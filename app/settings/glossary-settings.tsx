"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RiAddLine, RiDeleteBinLine, RiTextSnippet } from "@remixicon/react"

type Entry = { id: string; term: string; aliases: string[] }

export function GlossarySettings({ entries }: { entries: Entry[] }) {
  const router = useRouter()
  const [term, setTerm] = useState("")
  const [aliases, setAliases] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/glossary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          term,
          aliases: aliases
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean),
        }),
      })
      if (!res.ok)
        throw new Error((await res.json()).error ?? "Could not add term")
      setTerm("")
      setAliases("")
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/glossary/${id}`, { method: "DELETE" })
      if (!res.ok)
        throw new Error((await res.json()).error ?? "Could not delete term")
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-4 rounded-xl border bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <RiTextSnippet className="size-4" />
        </span>
        <div>
          <h2 className="text-sm font-medium">Glossary</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Help Engram spell names and specialist terms correctly. Add common
            mishearings as aliases.
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="Term"
          aria-label="Glossary term"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        <Input
          placeholder="Aliases, separated by commas"
          aria-label="Glossary aliases"
          value={aliases}
          onChange={(e) => setAliases(e.target.value)}
        />
        <Button
          size="sm"
          onClick={add}
          disabled={busy || term.trim().length === 0}
        >
          <RiAddLine data-icon="inline-start" />
          Add
        </Button>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <ul className="divide-y rounded-lg border">
        {entries.length === 0 && (
          <li className="px-3 py-4 text-xs text-muted-foreground">
            No terms yet.
          </li>
        )}
        {entries.map((e) => (
          <li
            key={e.id}
            className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs"
          >
            <span className="min-w-0">
              <strong className="font-medium">{e.term}</strong>
              {e.aliases.length > 0 && (
                <span className="ml-1 text-muted-foreground">
                  · {e.aliases.join(", ")}
                </span>
              )}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Delete ${e.term}`}
              onClick={() => remove(e.id)}
              disabled={busy}
            >
              <RiDeleteBinLine />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
