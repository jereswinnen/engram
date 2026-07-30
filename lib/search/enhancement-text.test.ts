import { describe, expect, it } from "vitest"
import { buildEnhancementSearchText } from "./enhancement-text"

describe("buildEnhancementSearchText", () => {
  it("indexes every generated-note field without JSON punctuation", () => {
    const text = buildEnhancementSearchText({
      overview: "Roadmap overview",
      keyPoints: ["Key point"],
      decisions: ["Ship Friday"],
      actionItems: [{ text: "Prepare release", owner: "Sam", due: "Friday" }],
      chapters: [
        { title: "Launch", gist: "Release details", startSeconds: 30 },
      ],
      openQuestions: ["Who verifies?"],
    })

    expect(text).toContain("Roadmap overview")
    expect(text).toContain("Key point")
    expect(text).toContain("Ship Friday")
    expect(text).toContain("Prepare release\nSam\nFriday")
    expect(text).toContain("Launch\nRelease details")
    expect(text).toContain("Who verifies?")
    expect(text).not.toContain("{")
  })
})
