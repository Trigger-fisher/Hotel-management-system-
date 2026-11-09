import "server-only";
import { getCorporatePortal } from "@/server/compose/portal";
import { route } from "@/server/http/route";
import { portalHotelQuery } from "@/server/services/notifications/schemas";

export const dynamic = "force-dynamic";

// The sidebar badge: how many notifications this company has not read yet.
export const GET = route({
  permission: "session",
  query: portalHotelQuery,
  handler: async ({ session, query }) => ({ data: await getCorporatePortal().unreadNotifications(session, query) }),
});
