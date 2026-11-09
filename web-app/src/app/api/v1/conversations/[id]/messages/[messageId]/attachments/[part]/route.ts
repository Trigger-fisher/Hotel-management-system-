import "server-only";
import { getConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";
import { attachmentParams } from "@/server/services/conversations/schemas";

// One attachment of an email, read from the mailbox when asked (never stored): always a download (Content-Disposition: attachment, nosniff, no-store), served as its own type
// only from a short safe list (else application/octet-stream), at most 4 MB. A bill PDF HMS sent needs the Bills right. Conversations View.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = route({
  permission: "session",
  params: attachmentParams,
  limits: [{ name: "conv-attachment", max: 20, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params }) => {
    const file = await getConversations().attachment(session, params.id, params.messageId, params.part);
    return { data: null, binary: { bytes: file.bytes, contentType: file.type, filename: file.name, disposition: "attachment" as const } };
  },
});
