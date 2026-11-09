import "server-only";
import { getPlatformConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";
import { conversationListQuery } from "@/server/services/conversations/schemas";

// Conversations, the PLATFORM's inbox (decision 66, A5): the platform mailbox's mail, newest first, with the page's own search and the count of every tab. Super Admin and
// Platform Admin alike (the console gate); never an API key. The hotels' conversations are not here (C4).
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  query: conversationListQuery,
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session, query }) => ({ data: await getPlatformConversations().list(session, query) }),
});
