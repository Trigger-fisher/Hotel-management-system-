import "server-only";
import { asGroup, getGroupConversations } from "@/server/compose/groupConversations";
import { route } from "@/server/http/route";
import { conversationParams } from "@/server/services/conversations/schemas";

// The group's own inbox (platform 0166): the same endpoint as the hotel's /api/v1/conversations/[id]/read, for the Group Admin of an active group only (compose/groupConversations.ts asGroup).
export const dynamic = "force-dynamic";

export const PUT = route({
  permission: "session",
  params: conversationParams,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params }) => ({ data: await getGroupConversations().setRead(await asGroup(session), params.id, true) }),
});

export const DELETE = route({
  permission: "session",
  params: conversationParams,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params }) => ({ data: await getGroupConversations().setRead(await asGroup(session), params.id, false) }),
});
