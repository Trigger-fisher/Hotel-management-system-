import "server-only";
import { getPlatformConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { conversationParams, noteBody } from "@/server/services/conversations/schemas";

// A note on a platform conversation, for the platform staff only. Never kept in the idempotency store.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: conversationParams,
  body: noteBody,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPlatformConversations().addNote(session, params.id, body.text, platformMeta(request, traceId)), status: 201 }),
});
