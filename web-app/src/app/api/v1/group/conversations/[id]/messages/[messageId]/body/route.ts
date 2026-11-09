import "server-only";
import { asGroup, getGroupConversations } from "@/server/compose/groupConversations";
import { route } from "@/server/http/route";
import { bodyQuery, messageParams } from "@/server/services/conversations/schemas";

// The group's own inbox (platform 0166): the same endpoint as the hotel's /api/v1/conversations/[id]/messages/[messageId]/body, for the Group Admin of an active group only (compose/groupConversations.ts asGroup).
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = route({
  permission: "session",
  params: messageParams,
  query: bodyQuery,
  limits: [{ name: "conv-body", max: 30, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, query }) => ({ data: await getGroupConversations().emailBody(await asGroup(session), params.id, params.messageId, { images: query.images === "1" }) }),
});
