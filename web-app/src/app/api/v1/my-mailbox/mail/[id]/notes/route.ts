import "server-only";
import { asPersonal, getPersonalConversations } from "@/server/compose/personalMailbox";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { conversationParams, noteBody } from "@/server/services/conversations/schemas";

// My mailbox (platform 0178, 0179): the same endpoint as the hotel's /api/v1/conversations/[id]/notes, run over the signed-in staff login's OWN rows (compose/personalMailbox.ts asPersonal): nobody else, no visit, no API key.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: conversationParams,
  body: noteBody,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPersonalConversations().addNote(await asPersonal(session), params.id, body.text, requestMeta(request, traceId)), status: 201 }),
});
