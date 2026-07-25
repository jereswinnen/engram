"use client"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { RiDownloadLine, RiFileCopyLine } from "@remixicon/react"

export function ExportButtons({ id }: { id: string }) {
  const [copied, setCopied] = useState(false)

  async function copyMarkdown() {
    const res = await fetch(`/api/recordings/${id}/export?format=md`)
    if (!res.ok) return
    await navigator.clipboard.writeText(await res.text())
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex gap-2">
      <Button asChild variant="outline" size="sm">
        <a href={`/api/recordings/${id}/export?format=md`}>
          <RiDownloadLine data-icon="inline-start" />
          <span className="hidden sm:inline">Markdown</span>
          <span className="sm:hidden">.md</span>
        </a>
      </Button>
      <Button asChild variant="outline" size="sm">
        <a href={`/api/recordings/${id}/export?format=json`}>
          <RiDownloadLine data-icon="inline-start" />
          <span className="hidden sm:inline">JSON</span>
          <span className="sm:hidden">.json</span>
        </a>
      </Button>
      <Button variant="outline" size="sm" onClick={copyMarkdown}>
        <RiFileCopyLine data-icon="inline-start" />
        {copied ? "Copied" : <span className="hidden md:inline">Copy</span>}
      </Button>
    </div>
  )
}
