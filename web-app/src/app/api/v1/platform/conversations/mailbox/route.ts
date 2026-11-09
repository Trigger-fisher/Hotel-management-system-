import "server-only";
import { getPlatformConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { platformMailboxBody } from "@/server/services/conversations/schemas";

// Console > Conversations > Settings > Mailbox (decision 66, A5): GET what is saved and where it stands; PATCH the reading switch and, for another mail server, its IMAP server
// (a public server name only; port 993 or 143). The login and the sealed password stay in Platform settings > Mail (Super Admin). Super Admin and Platform Admin.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session }) => ({ data: await getPlatformConversations().mailbox(session) }),
});

export const PATCH = route({
  permission: "session",
  body: platformMailboxBody,
  idempotency: "off",
  limits: [{ name: "conv-write", max: 60, windowSeconds: 60, by: "user" }],
  handler: async ({ session, body, request, traceId }) => ({ data: await getPlatformConversations().setMailbox(session, body, platformMeta(request, traceId)) }),
});
