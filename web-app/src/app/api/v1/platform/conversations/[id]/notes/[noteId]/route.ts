import "server-only";
import { getPlatformConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { noteParams } from "@/server/services/conversations/schemas";

// Removes a note of the platform hub: its author, or the Super Admin.
export const dynamic = "force-dynamic";

export const DELETE = route({
  permission: "session",
  params: noteParams,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, request, traceId }) => ({ data: await getPlatformConversations().deleteNote(session, params.id, params.noteId, platformMeta(request, traceId)) }),
});
