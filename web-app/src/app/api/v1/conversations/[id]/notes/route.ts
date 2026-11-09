import "server-only";
import { getConversations } from "@/server/compose/conversations";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { conversationParams, noteBody } from "@/server/services/conversations/schemas";

// A note on a conversation, for the team only (the guest never sees it). Conversations Edit. The text is never kept in the idempotency store (decision 66, A6).
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: conversationParams,
  body: noteBody,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getConversations().addNote(session, params.id, body.text, requestMeta(request, traceId)), status: 201 }),
});
