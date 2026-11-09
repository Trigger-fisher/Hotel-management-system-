import "server-only";
import { getWhatsAppCampaigns } from "@/server/compose/whatsappCampaigns";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { campaignBody } from "@/server/services/whatsapp/campaignSchemas";

// The hotel's WhatsApp campaigns: GET the list (Conversations View), POST a new draft (Conversations Edit).
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session }) => ({ data: await getWhatsAppCampaigns().list(session) }),
});

export const POST = route({
  permission: "session",
  body: campaignBody,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, body, request, traceId }) => ({ data: await getWhatsAppCampaigns().create(session, body, requestMeta(request, traceId)), status: 201 }),
});
