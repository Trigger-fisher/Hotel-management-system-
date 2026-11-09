import "server-only";
import { getPlatformConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";

// The platform staff (Super Admin and Platform Admins), for "Assign to".
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session }) => ({ data: await getPlatformConversations().staff(session) }),
});
