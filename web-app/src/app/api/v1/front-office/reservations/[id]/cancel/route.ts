import "server-only";
import { getFrontOfficeReservations } from "@/server/compose/frontOffice";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { cancelBody } from "@/server/services/frontOffice/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// Cancel with a reason, or a no-show (Pallav: an edit).
export const POST = route({
  permission: { key: "pms.reservations", level: "edit" },
  params: idParams,
  body: cancelBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getFrontOfficeReservations().cancel(session, params.id, body, requestMeta(request, traceId)) }),
});
