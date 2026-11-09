import "server-only";
import { asPersonal, getPersonalConversations } from "@/server/compose/personalMailbox";
import { route } from "@/server/http/route";
import { syncBody } from "@/server/services/conversations/schemas";

// My mailbox (platform 0178, 0179): the same endpoint as the hotel's /api/v1/conversations/sync, run over the signed-in staff login's OWN rows (compose/personalMailbox.ts asPersonal): nobody else, no visit, no API key.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route({
  permission: "session",
  body: syncBody,
  touch: false,
  idempotency: "off",
  limits: [{ name: "conv-sync", max: 4, windowSeconds: 60, by: "user" }],
  handler: async ({ session, body }) => ({ data: await getPersonalConversations().sync(await asPersonal(session), body) }),
});
