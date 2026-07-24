import { NextRequest, NextResponse } from "next/server"
import { recordingToMarkdown } from "@/lib/export/markdown"
import { recordingToExport } from "@/lib/export/json"
import { exportFilename } from "@/lib/export/filename"
import { getRecordingSpeakerMap } from "@/lib/speakers/store"
import { isAuthFailure, requirePrincipal } from "@/lib/auth/policy"
import { getOwnedRecordingBundle } from "@/lib/recordings/store"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const principal = await requirePrincipal(request, {
    scopes: ["transcripts:read"],
    mechanisms: ["session"],
  })
  if (isAuthFailure(principal)) return principal

  const { id } = await params
  const format = request.nextUrl.searchParams.get("format")
  if (format !== "md" && format !== "json") {
    return NextResponse.json(
      { error: "format must be md or json" },
      { status: 400 }
    )
  }

  const [bundle, speakerMap] = await Promise.all([
    getOwnedRecordingBundle(principal.userId, id),
    getRecordingSpeakerMap(principal.userId, id),
  ])
  if (!bundle) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const { recording: rec, transcription: tr, enhancement: enh } = bundle

  const body =
    format === "md"
      ? recordingToMarkdown(rec, tr ?? null, enh ?? null, speakerMap)
      : JSON.stringify(
          recordingToExport(rec, tr ?? null, enh ?? null, speakerMap),
          null,
          2
        )

  const filename = exportFilename(rec.title, rec.id, format)
  const contentType =
    format === "md"
      ? "text/markdown; charset=utf-8"
      : "application/json; charset=utf-8"

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
}
