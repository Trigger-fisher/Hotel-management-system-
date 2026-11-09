import "server-only";
import { getConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";
import { conversationParams } from "@/server/services/conversations/schemas";

// Read / unread, shared by the team (decision 66, A9): PUT marks the conversation read, DELETE marks it unread. Conversations View; never during a visit.
export const dynamic = "force-dynamic";

export const PUT = route({
  permission: "session",
  params: conversationParams,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params }) => ({ data: await getConversations().setRead(session, params.id, true) }),
});

export const DELETE = route({
  permission: "session",
  params: conversationParams,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params }) => ({ data: await getConversations().setRead(session, params.id, false) }),
});
