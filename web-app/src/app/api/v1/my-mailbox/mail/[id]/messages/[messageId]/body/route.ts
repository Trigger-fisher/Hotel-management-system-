import "server-only";
import { asPersonal, getPersonalConversations } from "@/server/compose/personalMailbox";
import { route } from "@/server/http/route";
import { bodyQuery, messageParams } from "@/server/services/conversations/schemas";

// My mailbox (platform 0178, 0179): the same endpoint as the hotel's /api/v1/conversations/[id]/messages/[messageId]/body, run over the signed-in staff login's OWN rows (compose/personalMailbox.ts asPersonal): nobody else, no visit, no API key.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = route({
  permission: "session",
  params: messageParams,
  query: bodyQuery,
  limits: [{ name: "conv-body", max: 30, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, query }) => ({ data: await getPersonalConversations().emailBody(await asPersonal(session), params.id, params.messageId, { images: query.images === "1" }) }),
});
