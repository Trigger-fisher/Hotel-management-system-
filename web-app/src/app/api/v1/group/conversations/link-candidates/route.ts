import "server-only";
import { asGroup, getGroupConversations } from "@/server/compose/groupConversations";
import { route } from "@/server/http/route";
import { linkCandidatesQuery } from "@/server/services/conversations/schemas";

// The group's own inbox (platform 0166): the same endpoint as the hotel's /api/v1/conversations/link-candidates, for the Group Admin of an active group only (compose/groupConversations.ts asGroup).
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  query: linkCandidatesQuery,
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session, query }) => ({ data: await getGroupConversations().linkCandidates(await asGroup(session), query.search, query.kind) }),
});
