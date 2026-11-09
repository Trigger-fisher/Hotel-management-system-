import "server-only";
import { getGuestPortal } from "@/server/compose/portal";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// "All hotels" for a guest: every linked hotel with what the guest owes it, the open bills, the open requests and whether they are staying there now (with the room); totals.
// A hotel that cannot be reached is named in `unavailable`. One call for the home screen and the app bar chip.
export const GET = route({
  permission: "session",
  handler: async ({ session }) => ({ data: await getGuestPortal().hotelsSummary(session) }),
});