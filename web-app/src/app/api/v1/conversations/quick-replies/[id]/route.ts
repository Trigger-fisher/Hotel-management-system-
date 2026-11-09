import "server-only";
import { getConversations } from "@/server/compose/conversations";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { quickReplyBody, quickReplyParams } from "@/server/services/conversations/schemas";

// One quick reply: PATCH changes it, DELETE removes it. Conversations Edit.
export const dynamic = "force-dynamic";

export const PATCH = route({
  permission: "session",
  params: quickReplyParams,
  body: quickReplyBody,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getConversations().updateQuickReply(session, params.id, body, requestMeta(request, traceId)) }),
});

export const DELETE = route({
  permission: "session",
  params: quickReplyParams,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, request, traceId }) => ({ data: await getConversations().deleteQuickReply(session, params.id, requestMeta(request, traceId)) }),
});
