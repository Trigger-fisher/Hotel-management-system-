import "server-only";
import { getFrontOfficeReservations } from "@/server/compose/frontOffice";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { reservationCreateBody, reservationListQuery } from "@/server/services/frontOffice/schemas";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "pms.reservations", level: "view" },
  cache: "private, no-cache",
  query: reservationListQuery,
  handler: async ({ session, query }) => ({ data: await getFrontOfficeReservations().list(session, query) }),
});

export const POST = route({
  permission: { key: "pms.reservations", level: "create" },
  body: reservationCreateBody,
  idempotency: "optional",
  handler: async ({ session, body, request, traceId }) => ({ data: await getFrontOfficeReservations().create(session, body, requestMeta(request, traceId)), status: 201 }),
});
