import "server-only";
import { getGroupConsole } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { groupHotelListQuery } from "@/server/services/platform/schemas";

export const dynamic = "force-dynamic";

// My member hotels (status 200 counts and kind counts like the platform list). The group is never in the query.
export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  query: groupHotelListQuery,
  handler: async ({ session, query }) => ({ data: await getGroupConsole().myHotels(session, query) }),
});
