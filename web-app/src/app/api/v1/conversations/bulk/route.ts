import "server-only";
import { getConversations } from "@/server/compose/conversations";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { bulkBody } from "@/server/services/conversations/schemas";

// The Email page's bulk actions (Gmail's): read, unread, done, reopen, star, unstar, Other, main list, snooze for 3 hours, Trash, on up to 100 ticked conversations. Conversations Edit;
// one system log line. No Idempotency-Key is kept (decision 66, A6).
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  body: bulkBody,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, body, request, traceId }) => ({ data: await getConversations().bulk(session, body.ids, body.action, requestMeta(request, traceId)) }),
});
