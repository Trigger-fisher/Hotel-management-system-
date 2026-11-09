import "server-only";
import { getConversations } from "@/server/compose/conversations";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { conversationParams, threadPatchBody, threadQuery } from "@/server/services/conversations/schemas";

// One conversation: GET the thread (the newest 50 messages, older ones with ?before), its notes and links (only what the viewer may see, A14) and what the viewer may do;
// PATCH exactly one of assignedTo, status (open / done) or box (main / Other): Conversations Edit. No Idempotency-Key is kept (decision 66, A6).
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  params: conversationParams,
  query: threadQuery,
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, query }) => ({ data: await getConversations().thread(session, params.id, query.before) }),
});

export const PATCH = route({
  permission: "session",
  params: conversationParams,
  body: threadPatchBody,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getConversations().patch(session, params.id, body, requestMeta(request, traceId)) }),
});
