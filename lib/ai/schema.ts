import { z } from "zod";

export const enhancementSchema = z.object({
  title: z.string().describe("Short, descriptive title in English"),
  overview: z.string().describe("Concise overview / TL;DR in English"),
  keyPoints: z.array(z.string()).describe("Key points discussed"),
  decisions: z.array(z.string()).describe("Explicit decisions made (empty if none)"),
  actionItems: z
    .array(
      z.object({
        text: z.string().describe("The action to take"),
        owner: z.string().optional().describe("The responsible speaker's name, if clear from the transcript"),
        due: z.string().optional().describe("Due date/timeframe exactly as stated, if any"),
      }),
    )
    .describe("Concrete action items"),
  chapters: z
    .array(
      z.object({
        title: z.string(),
        gist: z.string().describe("One-line summary of the section"),
        startSeconds: z.number().optional().describe("Approx start time in seconds, from the [mm:ss] timestamps"),
      }),
    )
    .describe("Topic outline / chapters in chronological order"),
  openQuestions: z.array(z.string()).describe("Unresolved questions or follow-ups (empty if none)"),
});

export type Enhancement = z.infer<typeof enhancementSchema>;
