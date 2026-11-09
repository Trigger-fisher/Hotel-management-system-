import "server-only";
import { getConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";
import { messageParams } from "@/server/services/conversations/schemas";

// A guest's photo, voice note, video or document from WhatsApp, kept in the hotel's own folder of the bucket for a limited time. A picture, voice note or video plays in the page; anything else is a
// download. Always nosniff and no-store. Only the hotel's own files (the folder is checked again before reading). Conversations View.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = route({
  permission: "session",
  params: messageParams,
  limits: [{ name: "conv-attachment", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params }) => {
    const file = await getConversations().whatsappMedia(session, params.id, params.messageId);
    return { data: null, binary: { bytes: file.bytes, contentType: file.type, filename: file.name, disposition: file.inline ? ("inline" as const) : ("attachment" as const) } };
  },
});
