import "server-only";
import { getPlatformConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";

// The console menu badge: the platform hub's unread count and where its mailbox stands. Does not keep a session alive. Before platform 0139 is run it answers 200 with the
// "needs the latest database update" state.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  touch: false,
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session }) => ({ data: await getPlatformConversations().summary(session) }),
});
