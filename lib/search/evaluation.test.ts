import { describe, expect, it } from "vitest"
import {
  evaluateCase,
  recallAtK,
  reciprocalRank,
  summarizeEvaluation,
} from "./evaluation"

describe("search evaluation", () => {
  it("deduplicates passages from the same recording before scoring", () => {
    expect(recallAtK(["wanted"], ["other", "other", "wanted"], 2)).toBe(1)
    expect(reciprocalRank(["wanted"], ["other", "other", "wanted"])).toBe(0.5)
  })

  it("reports recall and reciprocal rank without storing query text", () => {
    const first = evaluateCase(
      { id: "case-1", query: "private words", expectedRecordingIds: ["r2"] },
      ["r1", "r2"]
    )
    const second = evaluateCase(
      {
        id: "case-2",
        query: "more private words",
        expectedRecordingIds: ["r3"],
      },
      ["r1", "r2"]
    )

    expect(first).not.toHaveProperty("query")
    expect(summarizeEvaluation([first, second])).toEqual({
      cases: 2,
      meanReciprocalRank: 0.25,
      meanRecallAt3: 0.5,
      meanRecallAt5: 0.5,
      missedAt5: ["case-2"],
    })
  })
})
