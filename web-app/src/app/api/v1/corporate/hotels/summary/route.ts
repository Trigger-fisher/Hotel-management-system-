import "server-only";
import { getCorporatePortal } from "@/server/compose/portal";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// "All hotels": every linked hotel with what the company owes it, its open bills and its unread notifications, plus the totals. A hotel that cannot be reached is named in `unavailable`.
export const GET = route({
  permission: "session",
  handler: async ({ session }) => ({ data: await getCorporatePortal().hotelsSummary(session) }),
});
