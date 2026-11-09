import "server-only";
import { asPersonal, getPersonalConversations } from "@/server/compose/personalMailbox";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { quickReplyBody, quickReplyParams } from "@/server/services/conversations/schemas";

// My mailbox (platform 0178, 0179): the same endpoint as the hotel's /api/v1/conversations/quick-replies/[id], run over the signed-in staff login's OWN rows (compose/personalMailbox.ts asPersonal): nobody else, no visit, no API key.
export const dynamic = "force-dynamic";

export const PATCH = route({
  permission: "session",
  params: quickReplyParams,
  body: quickReplyBody,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPersonalConversations().updateQuickReply(await asPersonal(session), params.id, body, requestMeta(request, traceId)) }),
});

export const DELETE = route({
  permission: "session",
  params: quickReplyParams,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, request, traceId }) => ({ data: await getPersonalConversations().deleteQuickReply(await asPersonal(session), params.id, requestMeta(request, traceId)) }),
});
