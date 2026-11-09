import "server-only";
import { asGroup, getGroupConversations } from "@/server/compose/groupConversations";
import { route } from "@/server/http/route";
import { syncBody } from "@/server/services/conversations/schemas";

// The group's own inbox (platform 0166): the same endpoint as the hotel's /api/v1/conversations/sync, for the Group Admin of an active group only (compose/groupConversations.ts asGroup).
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route({
  permission: "session",
  body: syncBody,
  touch: false,
  idempotency: "off",
  limits: [{ name: "conv-sync", max: 4, windowSeconds: 60, by: "user" }],
  handler: async ({ session, body }) => ({ data: await getGroupConversations().sync(await asGroup(session), body) }),
});
