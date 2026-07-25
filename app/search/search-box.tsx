"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RiSearchLine } from "@remixicon/react"

export function SearchBox({ initialQuery }: { initialQuery: string }) {
  const router = useRouter()
  const [q, setQ] = useState(initialQuery)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        router.push(`/search?q=${encodeURIComponent(q.trim())}`)
      }}
      className="relative"
    >
      <RiSearchLine className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder="Search recordings and transcripts…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
        className="h-11 rounded-xl border-border bg-card pr-24 pl-10 shadow-[0_1px_2px_rgba(0,0,0,0.025)]"
      />
      <Button
        type="submit"
        size="sm"
        disabled={q.trim().length === 0}
        className="absolute top-2 right-2 rounded-lg"
      >
        <RiSearchLine data-icon="inline-start" />
        Search
      </Button>
    </form>
  )
}
