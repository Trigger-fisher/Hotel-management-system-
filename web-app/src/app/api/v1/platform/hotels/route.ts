import "server-only";
import { getPlatformHotels } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { hotelListQuery } from "@/server/services/platform/schemas";

// The hotel list with status counts and kind counts (docs/BACKEND.md 14.1). Hotels enter only through invitations, so there is no create.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  query: hotelListQuery,
  handler: async ({ session, query }) => ({ data: await getPlatformHotels().listHotels(session, query) }),
});