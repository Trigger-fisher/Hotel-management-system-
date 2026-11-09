import "server-only";
import { asPersonal, getPersonalConversations } from "@/server/compose/personalMailbox";
import { route } from "@/server/http/route";
import { conversationParams } from "@/server/services/conversations/schemas";

// My mailbox (platform 0178, 0179): the same endpoint as the hotel's /api/v1/conversations/[id]/read, run over the signed-in staff login's OWN rows (compose/personalMailbox.ts asPersonal): nobody else, no visit, no API key.
export const dynamic = "force-dynamic";

export const PUT = route({
  permission: "session",
  params: conversationParams,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params }) => ({ data: await getPersonalConversations().setRead(await asPersonal(session), params.id, true) }),
});

export const DELETE = route({
  permission: "session",
  params: conversationParams,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params }) => ({ data: await getPersonalConversations().setRead(await asPersonal(session), params.id, false) }),
});
