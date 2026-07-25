"use client"
import { useRef, useState } from "react"
import {
  RiArrowDownSLine,
  RiDownloadLine,
  RiFileCopyLine,
  RiFileTextLine,
} from "@remixicon/react"

export function ExportButtons({ id }: { id: string }) {
  const [copied, setCopied] = useState(false)
  const menuRef = useRef<HTMLDetailsElement>(null)

  async function copyMarkdown() {
    const res = await fetch(`/api/recordings/${id}/export?format=md`)
    if (!res.ok) return
    await navigator.clipboard.writeText(await res.text())
    setCopied(true)
    menuRef.current?.removeAttribute("open")
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <details ref={menuRef} className="group relative">
      <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-lg border bg-background px-3 text-xs font-medium transition-colors marker:hidden hover:bg-muted">
        <RiDownloadLine className="size-3.5" />
        Export
        <RiArrowDownSLine className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="absolute top-10 right-0 z-30 w-52 overflow-hidden rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg">
        <a
          href={`/api/recordings/${id}/export?format=md`}
          className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors hover:bg-muted"
        >
          <RiFileTextLine className="size-3.5 text-muted-foreground" />
          Download Markdown
        </a>
        <a
          href={`/api/recordings/${id}/export?format=json`}
          className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors hover:bg-muted"
        >
          <RiDownloadLine className="size-3.5 text-muted-foreground" />
          Download JSON
        </a>
        <button
          type="button"
          onClick={copyMarkdown}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-muted"
        >
          <RiFileCopyLine className="size-3.5 text-muted-foreground" />
          {copied ? "Copied" : "Copy as Markdown"}
        </button>
      </div>
    </details>
  )
}
