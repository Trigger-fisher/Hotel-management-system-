import "server-only";
import { getConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";
import { linkCandidatesQuery } from "@/server/services/conversations/schemas";

// What "Link guest" can offer for ?search (and ?kind): only the kinds the viewer may link to (A14); nothing without Conversations Edit.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  query: linkCandidatesQuery,
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session, query }) => ({ data: await getConversations().linkCandidates(session, query.search, query.kind) }),
});
