import "server-only";
import { getGroupConsole } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { groupAdminListQuery } from "@/server/services/platform/schemas";

export const dynamic = "force-dynamic";

// The Hotel Admins of my member hotels (live hotels). No group in the query.
export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  query: groupAdminListQuery,
  handler: async ({ session, query }) => ({ data: await getGroupConsole().myHotelAdmins(session, query) }),
});
