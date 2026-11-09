import "server-only";
import { getFrontOfficeReservations } from "@/server/compose/frontOffice";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { reservationUpdateBody } from "@/server/services/frontOffice/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "pms.reservations", level: "view" },
  params: idParams,
  handler: async ({ session, params }) => ({ data: await getFrontOfficeReservations().get(session, params.id) }),
});

export const PATCH = route({
  permission: { key: "pms.reservations", level: "edit" },
  params: idParams,
  body: reservationUpdateBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getFrontOfficeReservations().update(session, params.id, body, requestMeta(request, traceId)) }),
});
