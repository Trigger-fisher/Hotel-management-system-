import "server-only";
import { getConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";

// The hotel's WhatsApp channel (decision 66: design only for now). The live site answers "not connected yet" (no number, no templates); never sample data. Conversations View.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session }) => ({ data: await getConversations().whatsapp(session) }),
});
