import { z } from "zod";

export const enhancementSchema = z.object({
  title: z.string().describe("Korte, beschrijvende titel in het Nederlands"),
  summary: z.string().describe("Beknopte samenvatting in het Nederlands"),
  actionItems: z
    .array(z.string())
    .describe("Concrete actiepunten, met spreker indien duidelijk"),
  keyPoints: z.array(z.string()).describe("Belangrijkste besproken punten"),
});

export type Enhancement = z.infer<typeof enhancementSchema>;
