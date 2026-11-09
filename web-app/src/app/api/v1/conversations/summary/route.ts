import "server-only";
import { getConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";

// The menu badge: the team's unread count and where the mailbox and WhatsApp stand. A poll must not keep a session alive (touch: false). Before hotel 0050 is run it
// still answers 200 with the "needs the latest database update" state, so the poll stops by itself.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  touch: false,
  cache: "private, no-cache",
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session }) => ({ data: await getConversations().summary(session) }),
});
