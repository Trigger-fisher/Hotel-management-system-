import "server-only";
import { asGroup, getGroupConversations } from "@/server/compose/groupConversations";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { quickReplyBody } from "@/server/services/conversations/schemas";

// The group's own inbox (platform 0166): the same endpoint as the hotel's /api/v1/conversations/quick-replies, for the Group Admin of an active group only (compose/groupConversations.ts asGroup).
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session }) => ({ data: await getGroupConversations().quickReplies(await asGroup(session)) }),
});

export const POST = route({
  permission: "session",
  body: quickReplyBody,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, body, request, traceId }) => ({ data: await getGroupConversations().addQuickReply(await asGroup(session), body, requestMeta(request, traceId)), status: 201 }),
});
