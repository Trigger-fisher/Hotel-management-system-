import "server-only";
import { getPlatformConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";
import { conversationParams } from "@/server/services/conversations/schemas";

// Read / unread in the platform hub, shared by the platform staff: PUT read, DELETE unread.
export const dynamic = "force-dynamic";

export const PUT = route({
  permission: "session",
  params: conversationParams,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params }) => ({ data: await getPlatformConversations().setRead(session, params.id, true) }),
});

export const DELETE = route({
  permission: "session",
  params: conversationParams,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params }) => ({ data: await getPlatformConversations().setRead(session, params.id, false) }),
});
