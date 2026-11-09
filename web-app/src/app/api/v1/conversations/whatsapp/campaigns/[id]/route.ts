import "server-only";
import { z } from "zod";
import { getWhatsAppCampaigns } from "@/server/compose/whatsappCampaigns";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { campaignBody } from "@/server/services/whatsapp/campaignSchemas";

// One campaign: PATCH changes a draft, DELETE removes a draft, a finished or a cancelled one. Conversations Edit.
export const dynamic = "force-dynamic";
const params = z.strictObject({ id: z.uuid() });

export const PATCH = route({
  permission: "session",
  params,
  body: campaignBody,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params: p, body, request, traceId }) => ({ data: await getWhatsAppCampaigns().update(session, p.id, body, requestMeta(request, traceId)) }),
});

export const DELETE = route({
  permission: "session",
  params,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params: p, request, traceId }) => ({ data: await getWhatsAppCampaigns().remove(session, p.id, requestMeta(request, traceId)) }),
});
