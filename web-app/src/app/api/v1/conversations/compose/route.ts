import "server-only";
import { getConversations } from "@/server/compose/conversations";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { composeBody } from "@/server/services/conversations/schemas";

// Compose (the Email page): a new email to anyone, sent through the hotel's mailbox when it has one, otherwise through the hotel's mail (Amazon SES); or saved as a draft. It is kept in
// the person's conversation, so Sent and Drafts show it. Conversations Edit. No Idempotency-Key is kept: no email text is stored in the idempotency store (decision 66, A6).
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  body: composeBody,
  idempotency: "off",
  limits: [{ name: "conv-reply", max: 30, windowSeconds: 60, by: "user" }],
  handler: async ({ session, body, request, traceId }) => ({ data: await getConversations().compose(session, body, requestMeta(request, traceId)) }),
});
