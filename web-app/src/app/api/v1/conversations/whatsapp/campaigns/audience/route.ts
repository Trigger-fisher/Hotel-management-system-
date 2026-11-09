import "server-only";
import { getWhatsAppCampaigns } from "@/server/compose/whatsappCampaigns";
import { route } from "@/server/http/route";
import { audienceBody } from "@/server/services/whatsapp/campaignSchemas";

// How many guests an audience reaches now (a count only). Conversations View.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  body: audienceBody,
  idempotency: "off",
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session, body }) => ({ data: await getWhatsAppCampaigns().audience(session, body.audience) }),
});
