import "server-only";
import { asGroup, getGroupConversations } from "@/server/compose/groupConversations";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { quickReplyBody, quickReplyParams } from "@/server/services/conversations/schemas";

// The group's own inbox (platform 0166): the same endpoint as the hotel's /api/v1/conversations/quick-replies/[id], for the Group Admin of an active group only (compose/groupConversations.ts asGroup).
export const dynamic = "force-dynamic";

export const PATCH = route({
  permission: "session",
  params: quickReplyParams,
  body: quickReplyBody,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getGroupConversations().updateQuickReply(await asGroup(session), params.id, body, requestMeta(request, traceId)) }),
});

export const DELETE = route({
  permission: "session",
  params: quickReplyParams,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, request, traceId }) => ({ data: await getGroupConversations().deleteQuickReply(await asGroup(session), params.id, requestMeta(request, traceId)) }),
});
