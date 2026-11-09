import "server-only";
import { getCorporatePortal } from "@/server/compose/portal";
import { route } from "@/server/http/route";
import { portalHotelQuery } from "@/server/services/notifications/schemas";

export const dynamic = "force-dynamic";

// Marks every unread notification of this company as read.
export const POST = route({
  permission: "session",
  query: portalHotelQuery,
  idempotency: "optional",
  handler: async ({ session, query }) => ({ data: await getCorporatePortal().readAllNotifications(session, query) }),
});
