"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { RiArrowLeftLine, RiUploadCloud2Line } from "@remixicon/react"

export default function UploadPage() {
  const router = useRouter()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const file = data.get("file") as File | null
    if (!file || file.size === 0) {
      setError("Please select an audio file.")
      return
    }
    setUploading(true)
    setError(null)
    try {
      const res = await fetch("/api/recordings", { method: "POST", body: data })
      if (!res.ok) {
        const msg = await res
          .json()
          .then((d: { error?: string }) => d.error ?? "Upload failed")
          .catch(() => "Upload failed")
        setError(msg)
        return
      }
      const { id } = (await res.json()) as { id: string }
      router.push(`/recordings/${id}`)
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <Link
        href="/"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <RiArrowLeftLine className="size-4" /> Back
      </Link>
      <h1 className="mb-1 text-xl font-semibold tracking-[-0.02em]">
        Upload recording
      </h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Engram will transcribe, summarize, title, and index the recording.
      </p>
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 rounded-xl border bg-card p-4"
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="file" className="text-sm font-medium">
            Audio file
          </label>
          <Input id="file" name="file" type="file" accept="audio/*" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="title" className="text-sm font-medium">
            Title{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </label>
          <Input
            id="title"
            name="title"
            type="text"
            placeholder="Use filename as title"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={uploading}>
          <RiUploadCloud2Line data-icon="inline-start" />
          {uploading ? "Uploading…" : "Upload"}
        </Button>
      </form>
    </div>
  )
}
