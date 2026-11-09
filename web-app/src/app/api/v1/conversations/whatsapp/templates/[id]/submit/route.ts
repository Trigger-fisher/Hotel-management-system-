import "server-only";
import { z } from "zod";
import { getWhatsAppTemplates } from "@/server/compose/whatsappTemplates";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";

// Sends a draft (or an edited rejected message) to Meta for approval. Conversations Edit.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: z.strictObject({ id: z.uuid() }),
  idempotency: "off",
  limits: [{ name: "wa-template-submit", max: 20, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, request, traceId }) => ({ data: await getWhatsAppTemplates().submit(session, params.id, requestMeta(request, traceId)) }),
});
