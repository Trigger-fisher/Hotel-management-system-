import "server-only";
import { getFrontOfficeStays } from "@/server/compose/frontOffice";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { chargeParams } from "@/server/services/frontOffice/schemas";

export const dynamic = "force-dynamic";

// Removing a charge is a DELETE in Pallav: Full Access; only while in house.
export const DELETE = route({
  permission: { key: "pms.stays", level: "full" },
  params: chargeParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getFrontOfficeStays().removeCharge(session, params.id, params.chargeId, requestMeta(request, traceId)) }),
});
