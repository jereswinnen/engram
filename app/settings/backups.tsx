"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { RiArchiveLine, RiDownloadLine, RiAddLine } from "@remixicon/react"

type Backup = {
  id: string
  status: string
  sizeBytes: number | null
  error: string | null
  createdAt: string
}

function fmtSize(b: number | null) {
  if (b == null) return ""
  const mb = b / (1024 * 1024)
  return mb >= 1
    ? `${mb.toFixed(1)} MB`
    : `${Math.max(1, Math.round(b / 1024))} KB`
}

export function Backups({ initial }: { initial: Backup[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const pending = initial.some((b) => b.status === "pending")

  // Poll while any backup is still generating.
  useEffect(() => {
    if (!pending) return
    const t = setInterval(() => router.refresh(), 4000)
    return () => clearInterval(t)
  }, [pending, router])

  async function create() {
    setBusy(true)
    try {
      const res = await fetch("/api/backup", { method: "POST" })
      if (res.ok) router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-4 rounded-xl border bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <RiArchiveLine className="size-4" />
        </span>
        <div>
          <h2 className="text-sm font-medium">Backups</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            A full archive (audio + transcript + summary) of every recording, as
            a downloadable zip.
          </p>
        </div>
      </div>
      <Button size="sm" className="w-fit" onClick={create} disabled={busy}>
        <RiAddLine data-icon="inline-start" />
        Create backup
      </Button>
      <ul className="divide-y rounded-lg border text-xs">
        {initial.length === 0 && (
          <li className="px-3 py-4 text-muted-foreground">No backups yet.</li>
        )}
        {initial.map((b) => (
          <li
            key={b.id}
            className="flex items-center justify-between gap-3 px-3 py-2.5"
          >
            <span className="min-w-0 text-muted-foreground">
              {new Date(b.createdAt).toLocaleString("en-GB")} —{" "}
              {b.status === "ready"
                ? `Ready ${fmtSize(b.sizeBytes)}`
                : b.status === "pending"
                  ? "Generating…"
                  : `Failed${b.error ? `: ${b.error}` : ""}`}
            </span>
            {b.status === "ready" && (
              <Button asChild variant="ghost" size="xs">
                <a href={`/api/backup/${b.id}/download`}>
                  <RiDownloadLine data-icon="inline-start" />
                  Download
                </a>
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
