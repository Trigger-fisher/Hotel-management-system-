import "server-only";
import { getCorporatePortal } from "@/server/compose/portal";
import { route } from "@/server/http/route";
import { hotelQuery } from "@/server/services/corporate/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// Pay everything still due on one of the company's bills: 404 for another's, 409 when paid, else 422 while online payment is off.
export const POST = route({
  permission: "session",
  params: idParams,
  query: hotelQuery,
  idempotency: "optional",
  handler: async ({ session, params, query }) => ({ data: await getCorporatePortal().payBill(await getCorporatePortal().forHotel(session, query.hotel), params.id) }),
});
