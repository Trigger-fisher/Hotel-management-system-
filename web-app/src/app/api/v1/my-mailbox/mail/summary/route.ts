import "server-only";
import { asPersonal, getPersonalConversations } from "@/server/compose/personalMailbox";
import { route } from "@/server/http/route";

// My mailbox (platform 0178, 0179): the same endpoint as the hotel's /api/v1/conversations/summary, run over the signed-in staff login's OWN rows (compose/personalMailbox.ts asPersonal): nobody else, no visit, no API key.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  touch: false,
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session }) => ({ data: await getPersonalConversations().summary(await asPersonal(session)) }),
});
