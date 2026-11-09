import "server-only";
import { asGroup, getGroupConversations } from "@/server/compose/groupConversations";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { conversationParams, replyBody } from "@/server/services/conversations/schemas";

// The group's own inbox (platform 0166): the same endpoint as the hotel's /api/v1/conversations/[id]/reply, for the Group Admin of an active group only (compose/groupConversations.ts asGroup).
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route({
  permission: "session",
  params: conversationParams,
  body: replyBody,
  maxBodyBytes: 64 * 1024,
  idempotency: "off",
  limits: [{ name: "conv-reply", max: 20, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getGroupConversations().reply(await asGroup(session), params.id, body, requestMeta(request, traceId)), status: 201 }),
});
