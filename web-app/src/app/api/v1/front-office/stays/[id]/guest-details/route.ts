import "server-only";
import { getFrontOfficeStays } from "@/server/compose/frontOffice";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { guestDetailsBody } from "@/server/services/frontOffice/schemas";
import { idParams } from "@/server/validation/listQuery";

// The main guest's further details and the room's other guests, edited after check-in: the whole set is replaced (409 on a stale version).
export const dynamic = "force-dynamic";

export const PUT = route({
  permission: { key: "pms.stays", level: "edit" },
  params: idParams,
  body: guestDetailsBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getFrontOfficeStays().updateGuestDetails(session, params.id, body, requestMeta(request, traceId)) }),
});