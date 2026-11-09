import "server-only";
import { getConversations } from "@/server/compose/conversations";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { quickReplyBody } from "@/server/services/conversations/schemas";

// The hotel's quick replies: GET the list (Conversations View), POST a new one (Edit; a title is used once, in any case).
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session }) => ({ data: await getConversations().quickReplies(session) }),
});

export const POST = route({
  permission: "session",
  body: quickReplyBody,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, body, request, traceId }) => ({ data: await getConversations().addQuickReply(session, body, requestMeta(request, traceId)), status: 201 }),
});
