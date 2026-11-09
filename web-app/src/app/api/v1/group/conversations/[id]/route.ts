import "server-only";
import { asGroup, getGroupConversations } from "@/server/compose/groupConversations";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { conversationParams, threadPatchBody, threadQuery } from "@/server/services/conversations/schemas";

// The group's own inbox (platform 0166): the same endpoint as the hotel's /api/v1/conversations/[id], for the Group Admin of an active group only (compose/groupConversations.ts asGroup).
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  params: conversationParams,
  query: threadQuery,
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, query }) => ({ data: await getGroupConversations().thread(await asGroup(session), params.id, query.before) }),
});

export const PATCH = route({
  permission: "session",
  params: conversationParams,
  body: threadPatchBody,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getGroupConversations().patch(await asGroup(session), params.id, body, requestMeta(request, traceId)) }),
});
