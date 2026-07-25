import { createHash } from "node:crypto"
import { nameForLabel } from "@/lib/transcript/speaker-names"

export type TranscriptSegment = {
  start: number
  end: number
  text: string
  speaker?: string | null
}

export type TranscriptChunk = {
  index: number
  content: string
  contentHash: string
  startSeconds: number | null
  endSeconds: number | null
}

type ChunkOptions = {
  targetCharacters?: number
  overlapSegments?: number
  speakerMap?: Record<string, string>
  context?: string[]
}

function timestamp(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60)
  return `${minutes}:${remainder.toString().padStart(2, "0")}`
}

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

function chunkPlainText(fullText: string, targetCharacters: number) {
  const paragraphs = fullText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  const parts = paragraphs.length > 0 ? paragraphs : [fullText.trim()]
  const chunks: string[] = []
  let current = ""

  for (const part of parts) {
    if (current && current.length + part.length + 2 > targetCharacters) {
      chunks.push(current)
      current = part
    } else {
      current = current ? `${current}\n\n${part}` : part
    }
  }
  if (current) chunks.push(current)
  return chunks
}

export function chunkTranscript(
  segments: TranscriptSegment[],
  fullText: string,
  options: ChunkOptions = {}
): TranscriptChunk[] {
  const targetCharacters = options.targetCharacters ?? 1_800
  const overlapSegments = options.overlapSegments ?? 2
  const speakerMap = options.speakerMap ?? {}
  const context = (options.context ?? [])
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n")
  const withContext = (content: string) =>
    context ? `${context}\n\nTranscript passage:\n${content}` : content
  const usableSegments = segments.filter((segment) => segment.text.trim())

  if (usableSegments.length === 0) {
    return chunkPlainText(fullText, targetCharacters).map((text, index) => {
      const content = withContext(text)
      return {
        index,
        content,
        contentHash: hash(content),
        startSeconds: null,
        endSeconds: null,
      }
    })
  }

  const chunks: TranscriptChunk[] = []
  let start = 0

  while (start < usableSegments.length) {
    let end = start
    let characterCount = 0
    const lines: string[] = []

    while (end < usableSegments.length) {
      const segment = usableSegments[end]
      const line = `[${timestamp(segment.start)}] ${nameForLabel(segment.speaker ?? "?", speakerMap)}: ${segment.text.trim()}`
      if (
        lines.length > 0 &&
        characterCount + line.length + 1 > targetCharacters
      ) {
        break
      }
      lines.push(line)
      characterCount += line.length + 1
      end += 1
    }

    const content = withContext(lines.join("\n"))
    chunks.push({
      index: chunks.length,
      content,
      contentHash: hash(content),
      startSeconds: usableSegments[start].start,
      endSeconds: usableSegments[end - 1].end,
    })

    if (end >= usableSegments.length) break
    start = Math.max(start + 1, end - overlapSegments)
  }

  return chunks
}
