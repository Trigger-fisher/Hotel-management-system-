import "server-only";
import { getPlatformConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { conversationParams } from "@/server/services/conversations/schemas";

// "Always move this sender to Other" in the platform hub: PUT on, DELETE off.
export const dynamic = "force-dynamic";

export const PUT = route({
  permission: "session",
  params: conversationParams,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, request, traceId }) => ({ data: await getPlatformConversations().setMuted(session, params.id, true, platformMeta(request, traceId)) }),
});

export const DELETE = route({
  permission: "session",
  params: conversationParams,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, request, traceId }) => ({ data: await getPlatformConversations().setMuted(session, params.id, false, platformMeta(request, traceId)) }),
});
