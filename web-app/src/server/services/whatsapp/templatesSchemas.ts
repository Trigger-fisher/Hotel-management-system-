import "server-only";
import { z } from "zod";

// What the hotel's template routes accept: strict and bounded; the service checks the rules of Meta's wording again (templates.ts checkTemplate).
const button = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("url"), text: z.string().max(40), url: z.string().max(2000) }),
  z.strictObject({ kind: z.literal("quick_reply"), text: z.string().max(40) }),
]);

export const templateBody = z.strictObject({
  name: z.string().trim().min(1).max(80),
  // "hinglish" is eight letters (the old limit of five refused it)
  language: z.string().min(2).max(8),
  category: z.enum(["utility", "authentication", "marketing"]),
  body: z.string().min(1).max(2000),
  variables: z.array(z.strictObject({ index: z.number().int().min(1).max(20), name: z.string().max(40), example: z.string().max(80) })).max(20).default([]),
  buttons: z.array(button).max(10).default([]),
  starterKey: z.string().max(60).nullable().optional(),
});
/** What the service takes: the parsed body, where the lists may be left out. */
export type TemplateBody = z.input<typeof templateBody>;
