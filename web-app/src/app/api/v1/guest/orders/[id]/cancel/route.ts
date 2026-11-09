import "server-only";
import { getGuestPortal } from "@/server/compose/portal";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { hotelQuery } from "@/server/services/corporate/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// The guest cancels their own order: only while it is still placed and inside the hotel's window (409 with a sentence otherwise); its charges come off the room bill.
// Twice is fine. `?hotel=` names the order's hotel (required for a guest linked to several). Another guest's order is 404.
export const POST = route({
  permission: "session",
  params: idParams,
  query: hotelQuery,
  idempotency: "optional",
  handler: async ({ session, params, query, request, traceId }) => ({ data: await getGuestPortal().cancelRoomOrder(await getGuestPortal().forAction(session, query.hotel), params.id, requestMeta(request, traceId)) }),
});
