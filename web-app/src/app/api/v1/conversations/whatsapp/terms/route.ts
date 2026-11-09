import "server-only";
import { z } from "zod";
import { getWhatsAppTerms } from "@/server/compose/whatsappTerms";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";

// The hotel's WhatsApp terms: GET reads them and whether they were accepted (Conversations View), POST accepts them (the Hotel Admin only).
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session }) => ({ data: await getWhatsAppTerms().get(session) }),
});

export const POST = route({
  permission: "session",
  body: z.strictObject({}),
  idempotency: "off",
  limits: [{ name: "conv-write", max: 20, windowSeconds: 60, by: "user" }],
  handler: async ({ session, request, traceId }) => ({ data: await getWhatsAppTerms().accept(session, requestMeta(request, traceId)) }),
});
