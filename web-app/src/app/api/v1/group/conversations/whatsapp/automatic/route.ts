import "server-only";
import { asGroup, getGroupConversations } from "@/server/compose/groupConversations";
import { route } from "@/server/http/route";
import { whatsappAutomaticBody } from "@/server/services/conversations/schemas";

// The group's own inbox (platform 0166): the same endpoint as the hotel's /api/v1/conversations/whatsapp/automatic, for the Group Admin of an active group only (compose/groupConversations.ts asGroup).
export const dynamic = "force-dynamic";

export const PATCH = route({
  permission: "session",
  body: whatsappAutomaticBody,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session }) => ({ data: await getGroupConversations().setWhatsAppAutomatic(await asGroup(session)) }),
});
