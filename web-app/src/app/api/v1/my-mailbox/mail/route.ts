import "server-only";
import { asPersonal, getPersonalConversations } from "@/server/compose/personalMailbox";
import { route } from "@/server/http/route";
import { conversationListQuery } from "@/server/services/conversations/schemas";

// My mailbox (platform 0178, 0179): the same endpoint as the hotel's /api/v1/conversations, run over the signed-in staff login's OWN rows (compose/personalMailbox.ts asPersonal): nobody else, no visit, no API key.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  query: conversationListQuery,
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session, query }) => ({ data: await getPersonalConversations().list(await asPersonal(session), query) }),
});
