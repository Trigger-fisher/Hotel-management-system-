import "server-only";
import { getConversations } from "@/server/compose/conversations";
import { route } from "@/server/http/route";
import { sentMailQuery } from "@/server/services/conversations/schemas";

// The hotel's Email page, "Sent through Amazon SES": this hotel's own mail only (who, what kind, when, how it went; never the text), newest first. Anyone who may see Conversations; never
// during a platform visit and never an API key (the service checks).
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  query: sentMailQuery,
  limits: [{ name: "conv-read", max: 120, windowSeconds: 60, by: "user" }],
  handler: async ({ session, query }) => ({ data: await getConversations().sentMail(session, query) }),
});
