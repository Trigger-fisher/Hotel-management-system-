import "server-only";
import { getFrontOfficeStays } from "@/server/compose/frontOffice";
import { route } from "@/server/http/route";
import { prefillQuery } from "@/server/services/frontOffice/schemas";

export const dynamic = "force-dynamic";

// The check-in form, filled from a reservation when there is one.
export const GET = route({
  permission: { key: "pms.stays", level: "view" },
  cache: "private, no-cache",
  query: prefillQuery,
  handler: async ({ session, query }) => ({ data: await getFrontOfficeStays().prefill(session, query.reservationId) }),
});
