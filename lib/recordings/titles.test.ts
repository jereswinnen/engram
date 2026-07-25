import { describe, expect, it } from "vitest"
import { generatedTitleUpdate } from "./title-policy"

describe("generatedTitleUpdate", () => {
  it("replaces device titles while preserving the original", () => {
    expect(
      generatedTitleUpdate(
        {
          title: "25 Jul 2026 at 10:42",
          originalTitle: null,
          titleOrigin: "device",
        },
        "  iOS launch planning and next steps  "
      )
    ).toEqual({
      title: "iOS launch planning and next steps",
      originalTitle: "25 Jul 2026 at 10:42",
      titleOrigin: "generated",
    })
  })

  it("keeps the first original title on regeneration", () => {
    expect(
      generatedTitleUpdate(
        {
          title: "First generated title",
          originalTitle: "recording.m4a",
          titleOrigin: "generated",
        },
        "A better generated title"
      )
    ).toEqual({
      title: "A better generated title",
      originalTitle: "recording.m4a",
      titleOrigin: "generated",
    })
  })

  it.each(["user", "provider", "legacy"])(
    "does not replace a %s title",
    (titleOrigin) => {
      expect(
        generatedTitleUpdate(
          { title: "Keep me", originalTitle: null, titleOrigin },
          "Generated"
        )
      ).toBeNull()
    }
  )
})
