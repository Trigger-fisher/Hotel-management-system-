import "server-only";
import { z } from "zod";
import { getWhatsAppConsent } from "@/server/compose/whatsappConsent";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";

// A guest's agreement to automatic WhatsApp messages: GET reads it (Conversations View), PUT records or withdraws it (Conversations Edit).
export const dynamic = "force-dynamic";
const params = z.strictObject({ customerId: z.uuid() });

export const GET = route({
  permission: "session",
  params,
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params: p }) => ({ data: await getWhatsAppConsent().get(session, p.customerId) }),
});

export const PUT = route({
  permission: "session",
  params,
  body: z.strictObject({ on: z.boolean() }),
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params: p, body, request, traceId }) => ({ data: await getWhatsAppConsent().set(session, p.customerId, body.on, requestMeta(request, traceId)) }),
});
