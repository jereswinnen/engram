export type SearchEvaluationCase = {
  id: string
  query: string
  expectedRecordingIds: string[]
}

export type SearchEvaluationCaseResult = {
  id: string
  rankedRecordingIds: string[]
  reciprocalRank: number
  recallAt3: number
  recallAt5: number
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}

export function recallAtK(
  expectedRecordingIds: string[],
  rankedRecordingIds: string[],
  k: number
): number {
  const expected = new Set(expectedRecordingIds)
  if (expected.size === 0) return 0
  const found = new Set(unique(rankedRecordingIds).slice(0, k))
  return (
    Array.from(expected).filter((id) => found.has(id)).length / expected.size
  )
}

export function reciprocalRank(
  expectedRecordingIds: string[],
  rankedRecordingIds: string[]
): number {
  const expected = new Set(expectedRecordingIds)
  const rank = unique(rankedRecordingIds).findIndex((id) => expected.has(id))
  return rank === -1 ? 0 : 1 / (rank + 1)
}

export function evaluateCase(
  testCase: SearchEvaluationCase,
  rankedRecordingIds: string[]
): SearchEvaluationCaseResult {
  const ranked = unique(rankedRecordingIds)
  return {
    id: testCase.id,
    rankedRecordingIds: ranked,
    reciprocalRank: reciprocalRank(testCase.expectedRecordingIds, ranked),
    recallAt3: recallAtK(testCase.expectedRecordingIds, ranked, 3),
    recallAt5: recallAtK(testCase.expectedRecordingIds, ranked, 5),
  }
}

export function summarizeEvaluation(results: SearchEvaluationCaseResult[]) {
  const average = (select: (result: SearchEvaluationCaseResult) => number) =>
    results.length === 0
      ? 0
      : results.reduce((sum, result) => sum + select(result), 0) /
        results.length

  return {
    cases: results.length,
    meanReciprocalRank: average((result) => result.reciprocalRank),
    meanRecallAt3: average((result) => result.recallAt3),
    meanRecallAt5: average((result) => result.recallAt5),
    missedAt5: results
      .filter((result) => result.recallAt5 < 1)
      .map((result) => result.id),
  }
}
