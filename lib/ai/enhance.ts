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
    "Je bent een assistent die vergaderingen samenvat. Antwoord altijd in het Nederlands. " +
    "De transcriptie is gediarizeerd (sprekers gelabeld); attribueer actiepunten aan de juiste spreker waar mogelijk." +
    (opts.glossaryBlock ? `\n\n${opts.glossaryBlock}` : "");
  const { object } = await generateObject({
    model: openai(model),
    schema: enhancementSchema,
    system,
    prompt: `Transcriptie:\n\n${transcript}`,
  });
  return object;
}
