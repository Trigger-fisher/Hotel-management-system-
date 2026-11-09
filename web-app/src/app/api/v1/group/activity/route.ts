import "server-only";
import { getGroupConsole } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { groupActivityQuery } from "@/server/services/platform/schemas";

export const dynamic = "force-dynamic";

// What was done in my group (invitations, unlinks, visits, admin resets), newest first.
export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  query: groupActivityQuery,
  handler: async ({ session, query }) => ({ data: await getGroupConsole().activity(session, query) }),
});
