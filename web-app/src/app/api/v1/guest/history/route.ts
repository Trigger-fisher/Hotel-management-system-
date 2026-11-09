import "server-only";
import { getGuestPortal } from "@/server/compose/portal";
import { route } from "@/server/http/route";
import { guestHistoryQuery } from "@/server/services/guest/schemas";

export const dynamic = "force-dynamic";

// Everything charged to the guest and every payment, newest first, with tab counts.
export const GET = route({
  permission: "session",
  query: guestHistoryQuery,
  handler: async ({ session, query }) => ({ data: await getGuestPortal().historyAcross(session, query) }),
});
