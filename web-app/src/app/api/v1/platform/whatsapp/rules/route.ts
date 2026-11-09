import "server-only";
import { getWhatsAppRules } from "@/server/compose/whatsappRules";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { rulesUpdateBody } from "@/server/services/whatsapp/rulesSchemas";

// The WhatsApp Rules screen: the numbers, the three profiles, the lines and the global kill switch. Platform and Super Admin only. Risky changes need confirm: true.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  handler: async ({ session }) => ({ data: await getWhatsAppRules().get(session) }),
});

export const PUT = route({
  permission: "session",
  body: rulesUpdateBody,
  handler: async ({ session, body, request, traceId }) => ({ data: await getWhatsAppRules().update(session, body, platformMeta(request, traceId)) }),
});
