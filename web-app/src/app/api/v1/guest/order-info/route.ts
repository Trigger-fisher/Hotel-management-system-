import "server-only";
import { getGuestPortal } from "@/server/compose/portal";
import { route } from "@/server/http/route";
import { hotelQuery } from "@/server/services/corporate/schemas";

export const dynamic = "force-dynamic";

// The order-to-room page's first answer (decision 52): is the guest staying, and is the restaurant taking orders now (hours set by the hotel admin)? With one hotel (named, or the only
// one linked): `all: false` and that hotel's name, the room and the guest's name for the app bar. Under "All hotels" for a login linked to several: `all: true` and every hotel with
// whether the guest is staying there (and the room), so the screen offers only those.
export const GET = route({
  permission: "session",
  query: hotelQuery,
  handler: async ({ session, query }) => ({ data: await getGuestPortal().orderInfoFor(session, query.hotel) }),
});