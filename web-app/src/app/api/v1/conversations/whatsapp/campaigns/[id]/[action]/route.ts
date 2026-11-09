import "server-only";
import { getWhatsAppCampaigns } from "@/server/compose/whatsappCampaigns";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { campaignActionParams } from "@/server/services/whatsapp/campaignSchemas";

// One step of a campaign: start (fixes the audience and begins sending), pause, resume, cancel. Start, resume and cancel are the Hotel Admin's; the service says so.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: campaignActionParams,
  idempotency: "off",
  limits: [{ name: "wa-campaign-step", max: 30, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params: p, request, traceId }) => {
    const campaigns = getWhatsAppCampaigns();
    const meta = requestMeta(request, traceId);
    const data = p.action === "start" ? await campaigns.start(session, p.id, meta) : p.action === "pause" ? await campaigns.pause(session, p.id, meta) : p.action === "resume" ? await campaigns.resume(session, p.id, meta) : await campaigns.cancel(session, p.id, meta);
    return { data };
  },
});
