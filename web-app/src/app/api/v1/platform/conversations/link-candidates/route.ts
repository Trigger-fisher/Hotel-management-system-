import "server-only";
import { getPlatformConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";
import { linkCandidatesQuery } from "@/server/services/conversations/schemas";

// What a platform conversation can be linked to for ?search: platform accounts and hotels.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  query: linkCandidatesQuery,
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session, query }) => ({ data: await getPlatformConversations().linkCandidates(session, query.search, query.kind) }),
});
