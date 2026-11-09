import "server-only";
import { getGuestPortal } from "@/server/compose/portal";
import { route } from "@/server/http/route";
import { hotelQuery } from "@/server/services/corporate/schemas";
import { guestBillParams } from "@/server/services/guest/schemas";

export const dynamic = "force-dynamic";

// One of the guest's own bills ("<bill id>.hotel|food" or "stay.<stay id>.hotel|food"); anyone else's is 404.
export const GET = route({
  permission: "session",
  params: guestBillParams,
  query: hotelQuery,
  handler: async ({ session, params, query }) => ({ data: await getGuestPortal().getBill(await getGuestPortal().forHotel(session, query.hotel), params.id) }),
});
