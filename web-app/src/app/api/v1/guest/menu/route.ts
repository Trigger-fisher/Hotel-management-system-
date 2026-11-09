import "server-only";
import { getGuestPortal } from "@/server/compose/portal";
import { route } from "@/server/http/route";
import { guestMenuQuery } from "@/server/services/guest/schemas";

export const dynamic = "force-dynamic";

// The order-to-room page: the stay going on now and the menu (empty until HMS has a menu list).
export const GET = route({
  permission: "session",
  query: guestMenuQuery,
  handler: async ({ session, query }) => ({ data: await getGuestPortal().getMenu(await getGuestPortal().forHotel(session, query.hotel), query.search) }),
});
