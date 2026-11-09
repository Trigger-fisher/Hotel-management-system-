import "server-only";
import { asGroup, getGroupConversations } from "@/server/compose/groupConversations";
import { route } from "@/server/http/route";

// The group's own inbox (platform 0166): the same endpoint as the hotel's /api/v1/conversations/whatsapp, for the Group Admin of an active group only (compose/groupConversations.ts asGroup).
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session }) => ({ data: await getGroupConversations().whatsapp(await asGroup(session)) }),
});
