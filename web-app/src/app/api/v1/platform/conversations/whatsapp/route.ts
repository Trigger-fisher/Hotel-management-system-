import "server-only";
import { getPlatformConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";

// The platform's WhatsApp number (decision 66: design only for now): the live site answers "not connected yet", never sample data.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session }) => ({ data: await getPlatformConversations().whatsapp(session) }),
});
