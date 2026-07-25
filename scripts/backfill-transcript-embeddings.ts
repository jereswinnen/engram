import {
  embedLatestTranscript,
  listEmbeddingBackfillCandidates,
} from "@/lib/search/embeddings"

type Options = {
  dryRun: boolean
  limit: number
  recordingId?: string
}

function parseOptions(args: string[]): Options {
  const options: Options = { dryRun: false, limit: 10 }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--") {
      continue
    } else if (arg === "--dry-run") {
      options.dryRun = true
    } else if (arg === "--limit") {
      const value = Number(args[index + 1])
      if (!Number.isInteger(value) || value < 1 || value > 100) {
        throw new Error("--limit must be an integer between 1 and 100")
      }
      options.limit = value
      index += 1
    } else if (arg === "--recording-id") {
      const value = args[index + 1]
      if (!value) throw new Error("--recording-id requires a value")
      options.recordingId = value
      index += 1
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  const candidates = await listEmbeddingBackfillCandidates(options)
  console.info(
    JSON.stringify({
      phase: "start",
      dryRun: options.dryRun,
      candidates: candidates.length,
      limit: options.limit,
    })
  )

  let embedded = 0
  let planned = 0
  let skipped = 0
  let failed = 0
  let chunks = 0
  let tokens = 0

  for (const candidate of candidates) {
    try {
      const result = await embedLatestTranscript(
        candidate.ownerId,
        candidate.recordingId,
        { dryRun: options.dryRun }
      )
      chunks += result.chunks
      tokens += result.tokens
      if (result.skipped) skipped += 1
      else if (options.dryRun) planned += 1
      else embedded += 1
    } catch (error) {
      failed += 1
      console.error(
        JSON.stringify({
          phase: "recording-error",
          recordingId: candidate.recordingId,
          error: error instanceof Error ? error.message : String(error),
        })
      )
    }
  }

  console.info(
    JSON.stringify({
      phase: "complete",
      dryRun: options.dryRun,
      candidates: candidates.length,
      embedded,
      planned,
      skipped,
      failed,
      chunks,
      tokens,
    })
  )
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
