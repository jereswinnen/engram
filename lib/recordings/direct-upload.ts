const MAX_DURATION_SECONDS = 2_147_483_647
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type DirectUploadInput = {
  id: string
  title: string
  durationSeconds: number
  startedAt: Date
  byteCount: number
}

type ParseResult =
  | { input: DirectUploadInput; error?: never }
  | { input?: never; error: string }

export function isDirectUploadID(value: string): boolean {
  return UUID_PATTERN.test(value)
}

export function parseDirectUploadInput(value: unknown): ParseResult {
  if (!value || typeof value !== "object") {
    return { error: "A JSON object is required" }
  }

  const input = value as Record<string, unknown>
  const id = typeof input.id === "string" ? input.id.trim() : ""
  if (!isDirectUploadID(id)) {
    return { error: "id must be a valid UUID" }
  }

  const title = typeof input.title === "string" ? input.title.trim() : ""
  if (!title) return { error: "title is required" }
  if (title.length > 500) {
    return { error: "title must be 500 characters or fewer" }
  }

  const durationSeconds = input.durationSeconds
  if (
    typeof durationSeconds !== "number" ||
    !Number.isInteger(durationSeconds) ||
    durationSeconds < 0 ||
    durationSeconds > MAX_DURATION_SECONDS
  ) {
    return { error: "durationSeconds must be a non-negative integer" }
  }

  const startedAtValue = input.startedAt
  if (typeof startedAtValue !== "string") {
    return { error: "startedAt must be a valid date" }
  }
  const startedAt = new Date(startedAtValue)
  if (Number.isNaN(startedAt.getTime())) {
    return { error: "startedAt must be a valid date" }
  }

  const byteCount = input.byteCount
  if (
    typeof byteCount !== "number" ||
    !Number.isSafeInteger(byteCount) ||
    byteCount <= 0
  ) {
    return { error: "byteCount must be a positive integer" }
  }

  return {
    input: { id, title, durationSeconds, startedAt, byteCount },
  }
}

export async function parseDirectUploadRequest(
  request: Request
): Promise<ParseResult> {
  try {
    return parseDirectUploadInput(await request.json())
  } catch {
    return { error: "A valid JSON body is required" }
  }
}
