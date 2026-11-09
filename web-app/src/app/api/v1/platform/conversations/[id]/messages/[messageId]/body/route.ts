import "server-only";
import { getPlatformConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";
import { bodyQuery, messageParams } from "@/server/services/conversations/schemas";

// One email of the platform mailbox, opened when asked and never stored: sanitised HTML (remote images only with ?images=1), the text, the attachments' list. Mail HMS made
// itself (reset links, codes) is never shown (A10).
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = route({
  permission: "session",
  params: messageParams,
  query: bodyQuery,
  limits: [{ name: "conv-body", max: 30, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params, query }) => ({ data: await getPlatformConversations().emailBody(session, params.id, params.messageId, { images: query.images === "1" }) }),
});
