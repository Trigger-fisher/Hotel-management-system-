import "server-only";
import { getWhatsAppTemplates } from "@/server/compose/whatsappTemplates";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { templateBody } from "@/server/services/whatsapp/templatesSchemas";

// The hotel's WhatsApp message templates: GET the list (Conversations View), POST a new draft (Conversations Edit).
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session }) => ({ data: await getWhatsAppTemplates().list(session) }),
});

export const POST = route({
  permission: "session",
  body: templateBody,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, body, request, traceId }) => ({ data: await getWhatsAppTemplates().create(session, body, requestMeta(request, traceId)), status: 201 }),
});
