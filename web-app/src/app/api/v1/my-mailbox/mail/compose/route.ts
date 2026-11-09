import "server-only";
import { asPersonal, getPersonalConversations } from "@/server/compose/personalMailbox";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { composeBody } from "@/server/services/conversations/schemas";

// My mailbox (platform 0178, 0179): the same endpoint as the hotel's /api/v1/conversations/compose, run over the signed-in staff login's OWN rows (compose/personalMailbox.ts asPersonal): nobody else, no visit, no API key.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  body: composeBody,
  idempotency: "off",
  limits: [{ name: "conv-reply", max: 30, windowSeconds: 60, by: "user" }],
  handler: async ({ session, body, request, traceId }) => ({ data: await getPersonalConversations().compose(await asPersonal(session), body, requestMeta(request, traceId)) }),
});
