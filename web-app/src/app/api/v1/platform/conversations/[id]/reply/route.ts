import "server-only";
import { getPlatformConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { conversationParams, replyBody } from "@/server/services/conversations/schemas";

// A reply from the platform mailbox, through the platform's own mail server (threaded, filed in Sent, the sender recorded). WhatsApp: 409 for now. Never kept in the
// idempotency store.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route({
  permission: "session",
  params: conversationParams,
  body: replyBody,
  maxBodyBytes: 64 * 1024,
  idempotency: "off",
  limits: [{ name: "conv-reply", max: 20, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPlatformConversations().reply(session, params.id, body, platformMeta(request, traceId)), status: 201 }),
});
