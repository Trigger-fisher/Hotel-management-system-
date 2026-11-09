import "server-only";
import { getPlatformConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";
import { messageParams } from "@/server/services/conversations/schemas";

// A guest's file from WhatsApp on the platform number, kept in the platform's folder of the bucket for a limited time (same rules as the hotel's: nosniff, no-store, inert formats only).
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = route({
  permission: "session",
  params: messageParams,
  limits: [{ name: "conv-attachment", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params }) => {
    const file = await getPlatformConversations().whatsappMedia(session, params.id, params.messageId);
    return { data: null, binary: { bytes: file.bytes, contentType: file.type, filename: file.name, disposition: file.inline ? ("inline" as const) : ("attachment" as const) } };
  },
});
