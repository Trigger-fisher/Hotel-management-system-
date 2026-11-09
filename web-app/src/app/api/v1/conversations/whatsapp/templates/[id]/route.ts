import "server-only";
import { z } from "zod";
import { getWhatsAppTemplates } from "@/server/compose/whatsappTemplates";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { templateBody } from "@/server/services/whatsapp/templatesSchemas";

// One template: PATCH changes a draft or a rejected one, DELETE removes it (at Meta too, when it was sent). Conversations Edit.
export const dynamic = "force-dynamic";
const params = z.strictObject({ id: z.uuid() });

export const PATCH = route({
  permission: "session",
  params,
  body: templateBody,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params: p, body, request, traceId }) => ({ data: await getWhatsAppTemplates().update(session, p.id, body, requestMeta(request, traceId)) }),
});

export const DELETE = route({
  permission: "session",
  params,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params: p, request, traceId }) => ({ data: await getWhatsAppTemplates().remove(session, p.id, requestMeta(request, traceId)) }),
});
