import "server-only";
import { getConversations } from "@/server/compose/conversations";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { noteParams } from "@/server/services/conversations/schemas";

// Removes a note: its author, or the Hotel Admin. Conversations Edit.
export const dynamic = "force-dynamic";

export const DELETE = route({
  permission: "session",
  params: noteParams,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, request, traceId }) => ({ data: await getConversations().deleteNote(session, params.id, params.noteId, requestMeta(request, traceId)) }),
});
