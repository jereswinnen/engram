import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { config } from "@/lib/config";
import { enhancementSchema, type Enhancement } from "./schema";

export async function enhanceTranscript(
  transcript: string,
  opts: { model?: string; glossaryBlock?: string } = {},
): Promise<Enhancement> {
  const openai = createOpenAI({ apiKey: config.openAiApiKey() });
  const model = opts.model ?? config.llmModel();
  const system =
    "You are an assistant that produces high-quality meeting notes. Always answer in English. " +
    "The transcript is diarized (speakers labelled, names where known) with [mm:ss] timestamps. " +
    "Attribute each action item to the responsible speaker by name when clear, capture explicit decisions, " +
    "list the topics as chapters in order with an approximate startSeconds taken from the timestamps, " +
    "and note any open questions." +
    (opts.glossaryBlock ? `\n\n${opts.glossaryBlock}` : "");
  const { object } = await generateObject({
    model: openai(model),
    schema: enhancementSchema,
    system,
    prompt: `Transcript:\n\n${transcript}`,
  });
  return object;
}
