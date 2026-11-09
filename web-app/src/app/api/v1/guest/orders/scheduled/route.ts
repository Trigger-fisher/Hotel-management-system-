import "server-only";
import { getGuestPortal } from "@/server/compose/portal";
import { route } from "@/server/http/route";
import { hotelQuery } from "@/server/services/corporate/schemas";

export const dynamic = "force-dynamic";

// "Coming up": the guest's orders of the current stay that are scheduled for later, soonest first (at most 20); an empty list when not staying.
export const GET = route({
  permission: "session",
  query: hotelQuery,
  handler: async ({ session, query }) => ({ data: await getGuestPortal().scheduledOrdersAcross(session, query) }),
});