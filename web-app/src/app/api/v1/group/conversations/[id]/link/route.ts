import "server-only";
import { asGroup, getGroupConversations } from "@/server/compose/groupConversations";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { conversationParams, linkBody } from "@/server/services/conversations/schemas";

// The group's own inbox (platform 0166): the same endpoint as the hotel's /api/v1/conversations/[id]/link, for the Group Admin of an active group only (compose/groupConversations.ts asGroup).
export const dynamic = "force-dynamic";

export const PUT = route({
  permission: "session",
  params: conversationParams,
  body: linkBody,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getGroupConversations().setLink(await asGroup(session), params.id, body, requestMeta(request, traceId)) }),
});

export const DELETE = route({
  permission: "session",
  params: conversationParams,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, request, traceId }) => ({ data: await getGroupConversations().clearLink(await asGroup(session), params.id, requestMeta(request, traceId)) }),
});
