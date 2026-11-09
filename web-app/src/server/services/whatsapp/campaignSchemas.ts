import "server-only";
import { z } from "zod";

// What the campaign routes accept: strict and bounded; the service checks the rules again (campaigns.ts checkCampaign, and the message's blanks).
export const campaignBody = z.strictObject({
  name: z.string().trim().min(1).max(120),
  templateId: z.uuid(),
  audience: z.strictObject({ stayedWithinDays: z.number().int().min(1).max(3650).optional() }).default({}),
  variables: z.array(z.string().max(60)).max(20).default([]),
});
export const audienceBody = z.strictObject({ audience: z.strictObject({ stayedWithinDays: z.number().int().min(1).max(3650).optional() }).default({}) });
export const campaignActionParams = z.strictObject({ id: z.uuid(), action: z.enum(["start", "pause", "resume", "cancel"]) });
