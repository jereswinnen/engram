import { searchRecordings, type SearchHit, type SearchPage } from "./search"
import {
  searchGeneratedNotes,
  type GeneratedNoteHit,
  type GeneratedNoteSource,
} from "./enhancements"

export type EngramEvidenceSource = "transcript" | GeneratedNoteSource

export type EngramSearchSnippet = {
  text: string
  source: EngramEvidenceSource
  generated: boolean
  startSeconds: number | null
  endSeconds: number | null
}

export type EngramSearchDocument = {
  id: string
  title: string
  url: string
  createdAt: string
  snippets: EngramSearchSnippet[]
}

type SearchDependencies = {
  searchTranscripts?: (
    ownerId: string,
    query: string,
    options: { limit: number; offset: number }
  ) => Promise<SearchPage>
  searchNotes?: (
    ownerId: string,
    query: string,
    options: { limit: number }
  ) => Promise<GeneratedNoteHit[]>
}

type RankedSnippet = EngramSearchSnippet & { rankScore: number }

type CandidateDocument = {
  id: string
  title: string
  createdAt: Date
  score: number
  snippets: RankedSnippet[]
}

const FUSION_K = 60

function htmlSnippetToPlainText(value: string): string {
  return value
    .replaceAll("<mark>", "")
    .replaceAll("</mark>", "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
}

export function recordingUrl(
  appUrl: string,
  recordingId: string,
  startSeconds: number | null = null
): string {
  const url = new URL(`/recordings/${recordingId}`, appUrl)
  if (startSeconds !== null) url.searchParams.set("t", String(startSeconds))
  return url.toString()
}

export async function searchEngramDocuments(
  ownerId: string,
  query: string,
  options: {
    appUrl: string
    resultLimit?: number
    snippetsPerRecording?: number
    candidateLimit?: number
  },
  dependencies: SearchDependencies = {}
): Promise<{ results: EngramSearchDocument[] }> {
  const trimmed = query.trim()
  if (!trimmed) return { results: [] }

  const resultLimit = Math.max(1, Math.min(options.resultLimit ?? 8, 8))
  const snippetsPerRecording = Math.max(
    1,
    Math.min(options.snippetsPerRecording ?? 3, 3)
  )
  const candidateLimit = Math.max(
    resultLimit,
    Math.min(options.candidateLimit ?? 12, 12)
  )
  const transcriptSearch = dependencies.searchTranscripts ?? searchRecordings
  const noteSearch = dependencies.searchNotes ?? searchGeneratedNotes
  const [transcriptPage, noteHits] = await Promise.all([
    transcriptSearch(ownerId, trimmed, { limit: candidateLimit, offset: 0 }),
    noteSearch(ownerId, trimmed, { limit: candidateLimit }),
  ])

  const documents = new Map<string, CandidateDocument>()
  const addEvidence = (
    identity: { recordingId: string; title: string; createdAt: Date },
    snippet: EngramSearchSnippet,
    rank: number
  ) => {
    const rankScore = 1 / (FUSION_K + rank)
    const current = documents.get(identity.recordingId) ?? {
      id: identity.recordingId,
      title: identity.title,
      createdAt: identity.createdAt,
      score: 0,
      snippets: [],
    }
    current.score += rankScore
    current.snippets.push({ ...snippet, rankScore })
    documents.set(identity.recordingId, current)
  }

  transcriptPage.results.forEach((hit: SearchHit, index) => {
    addEvidence(
      hit,
      {
        text: htmlSnippetToPlainText(hit.snippet),
        source: "transcript",
        generated: false,
        startSeconds: hit.startSeconds,
        endSeconds: hit.endSeconds,
      },
      index + 1
    )
  })
  noteHits.forEach((hit, index) => {
    addEvidence(
      hit,
      {
        text: hit.snippet,
        source: hit.source,
        generated: true,
        startSeconds: hit.startSeconds,
        endSeconds: null,
      },
      index + 1
    )
  })

  const results = [...documents.values()]
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.createdAt.getTime() - left.createdAt.getTime() ||
        left.id.localeCompare(right.id)
    )
    .slice(0, resultLimit)
    .map((document) => {
      const snippets = document.snippets
        .sort((left, right) => right.rankScore - left.rankScore)
        .slice(0, snippetsPerRecording)
        .map((snippet) => ({
          text: snippet.text,
          source: snippet.source,
          generated: snippet.generated,
          startSeconds: snippet.startSeconds,
          endSeconds: snippet.endSeconds,
        }))
      const timestamp =
        snippets.find((snippet) => snippet.startSeconds !== null)
          ?.startSeconds ?? null
      return {
        id: document.id,
        title: document.title,
        url: recordingUrl(options.appUrl, document.id, timestamp),
        createdAt: document.createdAt.toISOString(),
        snippets,
      }
    })

  return { results }
}
