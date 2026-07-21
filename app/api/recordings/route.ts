import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { recordings } from "@/db/schema"
import { getStorage, buildAudioKey } from "@/lib/storage"
import { runTranscription, runEnhancement } from "@/lib/pipeline"
import { auth } from "@/auth"
import { isRecordingRequestAuthorized } from "@/lib/recordings/auth"

export { isRecordingRequestAuthorized as isAuthorized } from "@/lib/recordings/auth"

const MAX_DURATION_SECONDS = 2_147_483_647

type RecordingUploadInput = {
  file: File
  title: string
  source: "upload" | "mac"
  durationSeconds: number | null
  startedAt: Date | null
}

type ParseResult =
  | { input: RecordingUploadInput; error?: never }
  | { input?: never; error: string }

function stringField(form: FormData, name: string): string | null {
  const value = form.get(name)
  return typeof value === "string" ? value.trim() : null
}

export function parseRecordingUpload(form: FormData): ParseResult {
  const file = form.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return { error: "file required" }
  }

  const requestedSource = stringField(form, "source")
  if (
    requestedSource &&
    requestedSource !== "upload" &&
    requestedSource !== "mac"
  ) {
    return { error: "source must be upload or mac" }
  }

  const durationValue = stringField(form, "durationSeconds")
  let durationSeconds: number | null = null
  if (durationValue) {
    durationSeconds = Number(durationValue)
    if (
      !Number.isInteger(durationSeconds) ||
      durationSeconds < 0 ||
      durationSeconds > MAX_DURATION_SECONDS
    ) {
      return { error: "durationSeconds must be a non-negative integer" }
    }
  }

  const startedAtValue = stringField(form, "startedAt")
  let startedAt: Date | null = null
  if (startedAtValue) {
    startedAt = new Date(startedAtValue)
    if (Number.isNaN(startedAt.getTime())) {
      return { error: "startedAt must be a valid date" }
    }
  }

  return {
    input: {
      file,
      title: stringField(form, "title") || file.name,
      source: requestedSource === "mac" ? "mac" : "upload",
      durationSeconds,
      startedAt,
    },
  }
}

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const rows = await db.query.recordings.findMany()
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  if (!(await isRecordingRequestAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const form = await req.formData()
  const parsed = parseRecordingUpload(form)
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }
  const { file, title, source, durationSeconds, startedAt } = parsed.input

  const [rec] = await db
    .insert(recordings)
    .values({
      title,
      source,
      storageKey: "pending",
      contentType: file.type || "application/octet-stream",
      durationSeconds,
      ...(startedAt ? { createdAt: startedAt } : {}),
    })
    .returning()

  const key = buildAudioKey(rec.id, file.name)
  await getStorage().put(
    key,
    Buffer.from(await file.arrayBuffer()),
    rec.contentType
  )
  await db
    .update(recordings)
    .set({ storageKey: key })
    .where(eq(recordings.id, rec.id))

  // fire-and-forget the pipeline (Phase 0: route stays warm long enough on Railway)
  runTranscription(rec.id)
    .then(() => runEnhancement(rec.id))
    .catch(() => {})

  return NextResponse.json(
    { id: rec.id, url: `/recordings/${rec.id}` },
    { status: 201 }
  )
}
