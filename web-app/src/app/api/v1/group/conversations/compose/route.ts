import "server-only";
import { asGroup, getGroupConversations } from "@/server/compose/groupConversations";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { composeBody } from "@/server/services/conversations/schemas";

// The group's own inbox (platform 0166): the same endpoint as the hotel's /api/v1/conversations/compose, for the Group Admin of an active group only (compose/groupConversations.ts asGroup).
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  body: composeBody,
  idempotency: "off",
  limits: [{ name: "conv-reply", max: 30, windowSeconds: 60, by: "user" }],
  handler: async ({ session, body, request, traceId }) => ({ data: await getGroupConversations().compose(await asGroup(session), body, requestMeta(request, traceId)) }),
});
