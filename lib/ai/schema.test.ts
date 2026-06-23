import { describe, it, expect } from "vitest";
import { enhancementSchema } from "./schema";

const full = {
  title: "Sync", overview: "We discussed X.",
  keyPoints: ["a"], decisions: ["ship it"],
  actionItems: [{ text: "send quote", owner: "Bjorn", due: "Friday" }, { text: "review" }],
  chapters: [{ title: "Intro", gist: "hellos", startSeconds: 0 }, { title: "Budget", gist: "money" }],
  openQuestions: ["when to launch?"],
};

describe("enhancementSchema", () => {
  it("accepts a full object (optional owner/due/startSeconds may be absent)", () => {
    expect(enhancementSchema.safeParse(full).success).toBe(true);
  });
  it("rejects an action item without text", () => {
    expect(enhancementSchema.safeParse({ ...full, actionItems: [{ owner: "x" }] }).success).toBe(false);
  });
});
