import "server-only";
import { getPlatformConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { quickReplyBody } from "@/server/services/conversations/schemas";

// The platform's quick replies: GET the list, POST a new one (a title is used once, in any case).
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session }) => ({ data: await getPlatformConversations().quickReplies(session) }),
});

export const POST = route({
  permission: "session",
  body: quickReplyBody,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, body, request, traceId }) => ({ data: await getPlatformConversations().addQuickReply(session, body, platformMeta(request, traceId)), status: 201 }),
});
