import "server-only";
import { getGuestPortal } from "@/server/compose/portal";
import { route } from "@/server/http/route";
import { guestBillListQuery } from "@/server/services/guest/schemas";

export const dynamic = "force-dynamic";

// The guest's own bills, one per business (hotel and food), with tab counts; the stay going on now first.
export const GET = route({
  permission: "session",
  query: guestBillListQuery,
  handler: async ({ session, query }) => ({ data: await getGuestPortal().billsAcross(session, query) }),
});
