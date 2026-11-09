import "server-only";
import { z } from "zod";
import { getWhatsAppTemplates } from "@/server/compose/whatsappTemplates";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";

// Asks Meta for its decision on a sent message now (it also arrives by itself). Conversations Edit.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: z.strictObject({ id: z.uuid() }),
  idempotency: "off",
  limits: [{ name: "wa-template-check", max: 30, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, request, traceId }) => ({ data: await getWhatsAppTemplates().check(session, params.id, requestMeta(request, traceId)) }),
});
