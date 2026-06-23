import { describe, it, expect } from "vitest";
import { enhancementSchema } from "./schema";

const full = {
  title: "Sync", overview: "We discussed X.",
  keyPoints: ["a"], decisions: ["ship it"],
  actionItems: [{ text: "send quote", owner: "Bjorn", due: "Friday" }, { text: "review", owner: null, due: null }],
  chapters: [{ title: "Intro", gist: "hellos", startSeconds: 0 }, { title: "Budget", gist: "money", startSeconds: null }],
  openQuestions: ["when to launch?"],
};

describe("enhancementSchema", () => {
  it("accepts a full object (nullable owner/due/startSeconds may be null)", () => {
    expect(enhancementSchema.safeParse(full).success).toBe(true);
  });
  it("accepts owner: null explicitly", () => {
    expect(enhancementSchema.safeParse({ ...full, actionItems: [{ text: "do it", owner: null, due: null }] }).success).toBe(true);
  });
  it("rejects an action item without text", () => {
    expect(enhancementSchema.safeParse({ ...full, actionItems: [{ owner: "x", due: null }] }).success).toBe(false);
  });
});
