import { NextRequest, NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { recordings } from "@/db/schema"
import { getStorage, buildAudioKey } from "@/lib/storage"
import { runTranscription, runEnhancement } from "@/lib/pipeline"
import { isAuthFailure, requirePrincipal } from "@/lib/auth/policy"
import { ownerPredicate } from "@/lib/auth/ownership"

const MAX_DURATION_SECONDS = 2_147_483_647

type RecordingUploadInput = {
  file: File
  title: string
  titleOrigin: "user" | "filename"
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
      titleOrigin: stringField(form, "title") ? "user" : "filename",
      source: requestedSource === "mac" ? "mac" : "upload",
      durationSeconds,
      startedAt,
    },
  }
}

export async function GET(request: NextRequest) {
  const principal = await requirePrincipal(request, {
    scopes: ["recordings:read"],
  })
  if (isAuthFailure(principal)) return principal

  const rows = await db.query.recordings.findMany({
    where: ownerPredicate(recordings.ownerId, principal.userId),
  })
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const principal = await requirePrincipal(req, {
    scopes: ["recordings:write"],
    mechanisms: ["session", "legacy-mac"],
  })
  if (isAuthFailure(principal)) return principal

  const form = await req.formData()
  const parsed = parseRecordingUpload(form)
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }
  const { file, title, titleOrigin, durationSeconds, startedAt } = parsed.input
  // `source` is provenance, not a client-controlled authorization field.
  const source = principal.mechanism === "session" ? "upload" : "mac"

  const [rec] = await db
    .insert(recordings)
    .values({
      ownerId: principal.userId,
      createdByConnectionId: principal.connectionId,
      title,
      originalTitle: title,
      titleOrigin: source === "mac" ? "device" : titleOrigin,
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
    .where(
      and(
        eq(recordings.id, rec.id),
        ownerPredicate(recordings.ownerId, principal.userId)
      )
    )

  // fire-and-forget the pipeline (Phase 0: route stays warm long enough on Railway)
  runTranscription(principal.userId, rec.id)
    .then((transcribed) =>
      transcribed ? runEnhancement(principal.userId, rec.id) : undefined
    )
    .catch(() => {})

  return NextResponse.json(
    { id: rec.id, url: `/recordings/${rec.id}` },
    { status: 201 }
  )
}
