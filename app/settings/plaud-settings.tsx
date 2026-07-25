"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  RiCheckboxBlankCircleFill,
  RiRefreshLine,
  RiLink,
  RiLinkUnlink,
} from "@remixicon/react"

type LastResult = {
  ranAt: string
  newCount: number
  skippedCount: number
  failedCount: number
  deferredCount?: number
  processingErrorCount?: number
  note?: string
  error?: string
} | null

function summarize(r: {
  newCount: number
  skippedCount: number
  failedCount: number
  deferredCount?: number
  processingErrorCount?: number
}): string {
  const parts = [
    `${r.newCount} new`,
    `${r.skippedCount} skipped`,
    `${r.failedCount} failed`,
  ]
  if (r.deferredCount) parts.push(`${r.deferredCount} waiting for audio`)
  if (r.processingErrorCount)
    parts.push(`${r.processingErrorCount} processing errors`)
  return parts.join(", ")
}

export function PlaudSettings({
  connected,
  lastResult,
  oauthStatus,
}: {
  connected: boolean
  lastResult: LastResult
  oauthStatus: string | null
}) {
  const router = useRouter()
  const [status, setStatus] = useState<string | null>(
    oauthStatus === "connected"
      ? "Plaud connected."
      : oauthStatus === "error"
        ? "Failed to connect to Plaud."
        : null
  )
  const [busy, setBusy] = useState(false)

  async function disconnect() {
    setBusy(true)
    try {
      const res = await fetch("/api/plaud/disconnect", { method: "POST" })
      if (res.ok) {
        setStatus("Disconnected.")
        router.refresh()
      } else {
        setStatus("Failed to disconnect.")
      }
    } finally {
      setBusy(false)
    }
  }

  async function syncNow() {
    setBusy(true)
    setStatus("Syncing…")
    try {
      const res = await fetch("/api/sync", { method: "POST" })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "sync failed")
      setStatus(
        json.note
          ? `Sync: ${json.note}`
          : json.error
            ? `Sync: ${json.error}`
            : `Sync complete — ${summarize(json)}.`
      )
      router.refresh()
    } catch (e) {
      setStatus((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-5 rounded-xl border bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <RiLink className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium">Plaud</h2>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <RiCheckboxBlankCircleFill
                className={
                  connected
                    ? "size-2 text-emerald-500"
                    : "size-2 text-muted-foreground/50"
                }
              />
              {connected ? "Connected" : "Not connected"}
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Import Plaud recordings into the same searchable library.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 border-t pt-4">
        {connected ? (
          <Button
            variant="outline"
            size="sm"
            onClick={disconnect}
            disabled={busy}
          >
            <RiLinkUnlink data-icon="inline-start" />
            Disconnect
          </Button>
        ) : (
          <Button asChild size="sm">
            <a href="/api/plaud/connect">
              <RiLink data-icon="inline-start" />
              Connect Plaud
            </a>
          </Button>
        )}
        <Button size="sm" onClick={syncNow} disabled={busy || !connected}>
          <RiRefreshLine
            data-icon="inline-start"
            className={busy ? "animate-spin" : ""}
          />
          Sync now
        </Button>
      </div>
      {lastResult && (
        <p className="text-[11px] leading-4 text-muted-foreground">
          Last sync {new Date(lastResult.ranAt).toLocaleString("en-GB")} ·{" "}
          {lastResult.note ?? lastResult.error ?? summarize(lastResult)}
        </p>
      )}
      {status && (
        <p role="status" className="rounded-lg bg-muted px-3 py-2 text-xs">
          {status}
        </p>
      )}
    </section>
  )
}
