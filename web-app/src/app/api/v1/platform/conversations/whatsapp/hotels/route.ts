import "server-only";
import { getPlatformConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";

// Console > Conversations > Settings > WhatsApp: each hotel's connection and this month's counts, never chat content (D6). Empty until the Meta integration.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session }) => ({ data: await getPlatformConversations().whatsappHotels(session) }),
});
