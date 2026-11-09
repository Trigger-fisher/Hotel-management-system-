import "server-only";
import { getConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";

// The hotel's active staff, for "Assign to". Conversations View.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session }) => ({ data: await getConversations().staff(session) }),
});
