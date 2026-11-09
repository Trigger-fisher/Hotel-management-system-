import "server-only";
import { getPlatformConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { quickReplyBody, quickReplyParams } from "@/server/services/conversations/schemas";

// One platform quick reply: PATCH changes it, DELETE removes it.
export const dynamic = "force-dynamic";

export const PATCH = route({
  permission: "session",
  params: quickReplyParams,
  body: quickReplyBody,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPlatformConversations().updateQuickReply(session, params.id, body, platformMeta(request, traceId)) }),
});

export const DELETE = route({
  permission: "session",
  params: quickReplyParams,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, request, traceId }) => ({ data: await getPlatformConversations().deleteQuickReply(session, params.id, platformMeta(request, traceId)) }),
});
