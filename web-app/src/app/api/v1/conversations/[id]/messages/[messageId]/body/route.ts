import "server-only";
import { getConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";
import { bodyQuery, messageParams } from "@/server/services/conversations/schemas";

// One email opened from the mailbox (C3: never stored): its HTML sanitised on the server (no script, no handlers, no forms or frames; remote images held back until
// ?images=1), its text, the list of its attachments. Mail HMS made itself is never shown (A10). Conversations View; never kept by any cache (the wrapper's no-store).
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = route({
  permission: "session",
  params: messageParams,
  query: bodyQuery,
  limits: [{ name: "conv-body", max: 30, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, query }) => ({ data: await getConversations().emailBody(session, params.id, params.messageId, { images: query.images === "1" }) }),
});
