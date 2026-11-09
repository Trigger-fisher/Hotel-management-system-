import "server-only";
import { getCorporatePortal } from "@/server/compose/portal";
import { route } from "@/server/http/route";
import { portalHotelQuery } from "@/server/services/notifications/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// Marks one notification as read: 404 for another company's (or a withdrawn or expired) one. Reading it twice is fine.
export const POST = route({
  permission: "session",
  params: idParams,
  query: portalHotelQuery,
  idempotency: "optional",
  handler: async ({ session, params, query }) => ({ data: await getCorporatePortal().readNotification(session, query, params.id) }),
});
