import "server-only";
import { getConversations } from "@/server/compose/conversations";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { conversationParams, replyBody } from "@/server/services/conversations/schemas";

// A reply: email through the hotel's own mail server (threaded, filed in Sent, the sender recorded); WhatsApp answers "not connected yet" (409). It goes to the email's From
// (its Reply-To only when chosen on purpose); a bill PDF only to the linked guest's own address and only with the Bills right. Conversations Edit. The text is never kept
// in the idempotency store (decision 66, A6).
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route({
  permission: "session",
  params: conversationParams,
  body: replyBody,
  maxBodyBytes: 64 * 1024,
  idempotency: "off",
  limits: [{ name: "conv-reply", max: 20, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getConversations().reply(session, params.id, body, requestMeta(request, traceId)), status: 201 }),
});
