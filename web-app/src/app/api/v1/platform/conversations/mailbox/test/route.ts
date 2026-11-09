import "server-only";
import { getPlatformConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { emptyBody } from "@/server/services/conversations/schemas";

// "Test connection" of the platform mailbox with the SAVED settings: reading (IMAP) and sending (SMTP) at once, in fixed sentences (never the server's words). A few in five
// minutes (each one signs in to the mail server).
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route({
  permission: "session",
  body: emptyBody,
  idempotency: "off",
  limits: [{ name: "conv-mailbox-test", max: 5, windowSeconds: 300, by: "user" }],
  handler: async ({ session, request, traceId }) => ({ data: await getPlatformConversations().startMailboxTest(session, platformMeta(request, traceId)) }),
});
