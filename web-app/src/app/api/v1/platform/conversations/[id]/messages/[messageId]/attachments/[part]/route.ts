import "server-only";
import { getPlatformConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";
import { attachmentParams } from "@/server/services/conversations/schemas";

// One attachment of a platform email, read from the mailbox when asked: always a download (attachment, nosniff, no-store), a safe type or application/octet-stream, 4 MB at most.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = route({
  permission: "session",
  params: attachmentParams,
  limits: [{ name: "conv-attachment", max: 20, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params }) => {
    const file = await getPlatformConversations().attachment(session, params.id, params.messageId, params.part);
    return { data: null, binary: { bytes: file.bytes, contentType: file.type, filename: file.name, disposition: "attachment" as const } };
  },
});
