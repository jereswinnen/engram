import { describe, it, expect } from "vitest";
import { enhancementSchema } from "./schema";

describe("enhancementSchema", () => {
  it("accepts a well-formed object", () => {
    const parsed = enhancementSchema.parse({
      title: "Wekelijkse sync",
      summary: "Het team besprak de planning.",
      actionItems: ["Jan: stuur de offerte"],
      keyPoints: ["Deadline verschoven"],
    });
    expect(parsed.actionItems).toHaveLength(1);
  });
  it("rejects missing fields", () => {
    expect(() => enhancementSchema.parse({ title: "x" })).toThrow();
  });
});
