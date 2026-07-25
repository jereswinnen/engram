import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import {
  evaluateCase,
  summarizeEvaluation,
  type SearchEvaluationCase,
} from "@/lib/search/evaluation"
import { searchRecordings } from "@/lib/search/search"

type Options = {
  dataset: string
  ownerId: string
}

function parseOptions(args: string[]): Options {
  let dataset = ""
  let ownerId = process.env.SEARCH_EVAL_OWNER_ID?.trim() ?? ""
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--") continue
    if (arg === "--dataset") {
      dataset = args[++index] ?? ""
    } else if (arg === "--owner-id") {
      ownerId = args[++index] ?? ""
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (!dataset) throw new Error("--dataset is required")
  if (!ownerId) {
    throw new Error("--owner-id or SEARCH_EVAL_OWNER_ID is required")
  }
  return { dataset, ownerId }
}

function validateDataset(value: unknown): SearchEvaluationCase[] {
  if (!Array.isArray(value)) throw new Error("dataset must be a JSON array")
  for (const item of value) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.id !== "string" ||
      typeof item.query !== "string" ||
      !Array.isArray(item.expectedRecordingIds) ||
      item.expectedRecordingIds.length === 0 ||
      item.expectedRecordingIds.some((id: unknown) => typeof id !== "string")
    ) {
      throw new Error(
        "each case needs id, query, and at least one expectedRecordingId"
      )
    }
  }
  return value as SearchEvaluationCase[]
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  const dataset = validateDataset(
    JSON.parse(await readFile(resolve(options.dataset), "utf8"))
  )
  const results = []

  for (const testCase of dataset) {
    const page = await searchRecordings(options.ownerId, testCase.query, {
      limit: 50,
    })
    results.push(
      evaluateCase(
        testCase,
        page.results.map((hit) => hit.recordingId)
      )
    )
  }

  console.info(JSON.stringify(summarizeEvaluation(results), null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
