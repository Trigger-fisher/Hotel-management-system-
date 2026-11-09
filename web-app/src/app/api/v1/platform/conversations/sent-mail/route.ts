import "server-only";
import { getPlatformConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";
import { sentMailQuery } from "@/server/services/conversations/schemas";

// The platform's Email page, "Sent through Amazon SES": every mail the system sent, with the hotel named (who, what kind, when, how it went; never the text), newest first. Super Admin and
// Platform Admin alike (the console gate); never an API key.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  query: sentMailQuery,
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session, query }) => ({ data: await getPlatformConversations().sentMail(session, query) }),
});
