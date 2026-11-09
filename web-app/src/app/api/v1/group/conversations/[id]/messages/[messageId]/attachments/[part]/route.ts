import "server-only";
import { asGroup, getGroupConversations } from "@/server/compose/groupConversations";
import { route } from "@/server/http/route";
import { attachmentParams } from "@/server/services/conversations/schemas";

// The group's own inbox (platform 0166): the same endpoint as the hotel's /api/v1/conversations/[id]/messages/[messageId]/attachments/[part], for the Group Admin of an active group only (compose/groupConversations.ts asGroup).
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = route({
  permission: "session",
  params: attachmentParams,
  limits: [{ name: "conv-attachment", max: 20, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params }) => {
    const file = await getGroupConversations().attachment(await asGroup(session), params.id, params.messageId, params.part);
    return { data: null, binary: { bytes: file.bytes, contentType: file.type, filename: file.name, disposition: "attachment" as const } };
  },
});
