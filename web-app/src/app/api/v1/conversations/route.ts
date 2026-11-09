import "server-only";
import { getConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";
import { conversationListQuery } from "@/server/services/conversations/schemas";

// Conversations (decision 66): the hotel's inbox, newest first (decision 52), with the page's own search (decision 51), the count of every tab and where the mailbox
// stands. The Hotel Admin, or the Conversations right (View); never during a platform visit, never an API key (the service checks).
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  query: conversationListQuery,
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session, query }) => ({ data: await getConversations().list(session, query) }),
});
