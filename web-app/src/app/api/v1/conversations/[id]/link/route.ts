import "server-only";
import { getConversations } from "@/server/compose/conversations";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { conversationParams, linkBody } from "@/server/services/conversations/schemas";

// "Link guest": PUT { kind, targetId } links the person to a stay, a booking, a guest record or a company (Conversations Edit and the View right of that record's module,
// A14); DELETE removes the link (the messages stay).
export const dynamic = "force-dynamic";

export const PUT = route({
  permission: "session",
  params: conversationParams,
  body: linkBody,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getConversations().setLink(session, params.id, body, requestMeta(request, traceId)) }),
});

export const DELETE = route({
  permission: "session",
  params: conversationParams,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, request, traceId }) => ({ data: await getConversations().clearLink(session, params.id, requestMeta(request, traceId)) }),
});
