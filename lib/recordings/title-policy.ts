export type RecordingTitleOrigin =
  | "user"
  | "filename"
  | "device"
  | "provider"
  | "generated"
  | "legacy"

const REPLACEABLE_TITLE_ORIGINS = new Set<RecordingTitleOrigin>([
  "filename",
  "device",
  "provider",
  "generated",
])

export function generatedTitleUpdate(
  recording: {
    title: string
    originalTitle: string | null
    titleOrigin: string
  },
  generatedTitle: string
) {
  const title = generatedTitle.trim().replace(/\s+/g, " ").slice(0, 500)
  if (
    !title ||
    !REPLACEABLE_TITLE_ORIGINS.has(
      recording.titleOrigin as RecordingTitleOrigin
    )
  ) {
    return null
  }

  return {
    title,
    originalTitle: recording.originalTitle ?? recording.title,
    titleOrigin: "generated" as const,
  }
}
