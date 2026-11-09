import "server-only";
import { getConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";
import { whatsappAutomaticBody } from "@/server/services/conversations/schemas";

// The automatic WhatsApp messages ({ key, on }): 409 "WhatsApp is not connected yet." until the Meta integration exists. Conversations Edit.
export const dynamic = "force-dynamic";

export const PATCH = route({
  permission: "session",
  body: whatsappAutomaticBody,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session }) => ({ data: await getConversations().setWhatsAppAutomatic(session) }),
});
