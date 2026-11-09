import "server-only";
import { getPlatformConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { whatsappAutomaticBody } from "@/server/services/conversations/schemas";

// The platform's automatic WhatsApp messages: 409 "WhatsApp is not connected yet." until the Meta integration exists.
export const dynamic = "force-dynamic";

export const PATCH = route({
  permission: "session",
  body: whatsappAutomaticBody,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, request, traceId }) => ({ data: await getPlatformConversations().setWhatsAppAutomatic(session, platformMeta(request, traceId)) }),
});
