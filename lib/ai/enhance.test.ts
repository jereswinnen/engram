import { describe, it, expect, vi, beforeEach } from "vitest";

const captured: any = {};
vi.mock("ai", () => ({
  generateObject: vi.fn(async (args: any) => {
    captured.system = args.system; captured.prompt = args.prompt; captured.schema = args.schema;
    return { object: { title: "T", overview: "O", keyPoints: [], decisions: [], actionItems: [], chapters: [], openQuestions: [] } };
  }),
}));
vi.mock("@ai-sdk/openai", () => ({ createOpenAI: () => () => ({}) }));
vi.mock("@/lib/config", () => ({ config: { openAiApiKey: () => "k", llmModel: () => "test-model" } }));
beforeEach(() => { for (const k of Object.keys(captured)) delete captured[k]; });

describe("enhanceTranscript", () => {
  it("uses an English system prompt and includes the glossary block", async () => {
    const { enhanceTranscript } = await import("./enhance");
    await enhanceTranscript("[0:05] Speaker 1: hi", { glossaryBlock: "GLOSSARY-XYZ" });
    expect(captured.system).toMatch(/English/i);
    expect(captured.system).not.toMatch(/Nederlands/);
    expect(captured.system).toContain("GLOSSARY-XYZ");
    expect(captured.prompt).toContain("[0:05] Speaker 1: hi");
  });
});
