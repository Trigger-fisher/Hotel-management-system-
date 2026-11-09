import "server-only";
import { getPlatformConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { conversationParams, threadPatchBody, threadQuery } from "@/server/services/conversations/schemas";

// One conversation of the platform hub: GET the thread (older messages with ?before); PATCH exactly one of assignedTo, status, box or labels (the desks Sales and Support among them; star and snooze are the hotels' only). Audited with fixed words.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  params: conversationParams,
  query: threadQuery,
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, query }) => ({ data: await getPlatformConversations().thread(session, params.id, query.before) }),
});

export const PATCH = route({
  permission: "session",
  params: conversationParams,
  body: threadPatchBody,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPlatformConversations().patch(session, params.id, body, platformMeta(request, traceId)) }),
});
