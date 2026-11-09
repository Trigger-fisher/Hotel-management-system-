import "server-only";
import { getPlatformConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";
import { syncBody } from "@/server/services/conversations/schemas";

// A mail check of the platform mailbox ({ background?: boolean }), throttled in the service; the answer carries the summary. Does not keep a session alive.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route({
  permission: "session",
  body: syncBody,
  touch: false,
  idempotency: "off",
  limits: [{ name: "conv-sync", max: 4, windowSeconds: 60, by: "user" }],
  handler: async ({ session, body }) => ({ data: await getPlatformConversations().sync(session, body) }),
});
