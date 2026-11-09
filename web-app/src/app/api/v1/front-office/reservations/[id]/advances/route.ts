import "server-only";
import { getFrontOfficeReservations } from "@/server/compose/frontOffice";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { reservationAdvanceBody } from "@/server/services/frontOffice/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// A payment against the reservation, recorded in Guest Advances. Money: Idempotency-Key honoured.
export const POST = route({
  permission: { key: "pms.reservations", level: "create" },
  params: idParams,
  body: reservationAdvanceBody,
  idempotency: "optional",
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getFrontOfficeReservations().addAdvance(session, params.id, body, requestMeta(request, traceId)), status: 201 }),
});
