import "server-only";
import { getGuestPortal } from "@/server/compose/portal";
import { route } from "@/server/http/route";
import { hotelQuery } from "@/server/services/corporate/schemas";

export const dynamic = "force-dynamic";

// Guest portal home: profile, the stay going on now, bills to pay, recent activity. A guest account only (record scope); anyone else is 403.
export const GET = route({
  permission: "session",
  query: hotelQuery,
  handler: async ({ session, query }) => ({ data: await getGuestPortal().overviewAcross(session, query) }),
});
