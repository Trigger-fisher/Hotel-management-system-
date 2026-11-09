import "server-only";
import { getCorporatePortal } from "@/server/compose/portal";
import { route } from "@/server/http/route";
import { hotelQuery } from "@/server/services/corporate/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// One of the company's bills; any other id is 404.
export const GET = route({
  permission: "session",
  params: idParams,
  query: hotelQuery,
  handler: async ({ session, params, query }) => ({ data: await getCorporatePortal().getBill(await getCorporatePortal().forHotel(session, query.hotel), params.id) }),
});
