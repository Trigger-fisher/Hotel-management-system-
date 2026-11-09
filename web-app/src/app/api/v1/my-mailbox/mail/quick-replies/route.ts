import "server-only";
import { asPersonal, getPersonalConversations } from "@/server/compose/personalMailbox";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { quickReplyBody } from "@/server/services/conversations/schemas";

// My mailbox (platform 0178, 0179): the same endpoint as the hotel's /api/v1/conversations/quick-replies, run over the signed-in staff login's OWN rows (compose/personalMailbox.ts asPersonal): nobody else, no visit, no API key.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session }) => ({ data: await getPersonalConversations().quickReplies(await asPersonal(session)) }),
});

export const POST = route({
  permission: "session",
  body: quickReplyBody,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, body, request, traceId }) => ({ data: await getPersonalConversations().addQuickReply(await asPersonal(session), body, requestMeta(request, traceId)), status: 201 }),
});
