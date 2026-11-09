import "server-only";
import { getConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";
import { syncBody } from "@/server/services/conversations/schemas";

// A mail check of the hotel's mailbox ({ background?: boolean }): "Check now", the page's minute check and the badge's poll. Throttled in the service (50 seconds on
// screen, about 1.5 minutes in the background); the answer carries the summary, so the badge needs one request. Does not keep a session alive. No Idempotency-Key is kept.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route({
  permission: "session",
  body: syncBody,
  touch: false,
  idempotency: "off",
  limits: [{ name: "conv-sync", max: 4, windowSeconds: 60, by: "user" }],
  handler: async ({ session, body }) => ({ data: await getConversations().sync(session, body) }),
});
