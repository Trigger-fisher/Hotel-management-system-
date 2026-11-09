import "server-only";
import { asPersonal, getPersonalConversations } from "@/server/compose/personalMailbox";
import { route } from "@/server/http/route";
import { attachmentParams } from "@/server/services/conversations/schemas";

// My mailbox (platform 0178, 0179): the same endpoint as the hotel's /api/v1/conversations/[id]/messages/[messageId]/attachments/[part], run over the signed-in staff login's OWN rows (compose/personalMailbox.ts asPersonal): nobody else, no visit, no API key.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = route({
  permission: "session",
  params: attachmentParams,
  limits: [{ name: "conv-attachment", max: 20, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params }) => {
    const file = await getPersonalConversations().attachment(await asPersonal(session), params.id, params.messageId, params.part);
    return { data: null, binary: { bytes: file.bytes, contentType: file.type, filename: file.name, disposition: "attachment" as const } };
  },
});
