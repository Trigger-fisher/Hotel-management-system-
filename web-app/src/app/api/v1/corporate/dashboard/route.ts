import "server-only";
import { getCorporatePortal } from "@/server/compose/portal";
import { route } from "@/server/http/route";
import { hotelQuery } from "@/server/services/corporate/schemas";

export const dynamic = "force-dynamic";

// Decision 48: the calm dashboard (a few cards, the oldest open bills, the last payments; no pay links), for one hotel or all.
export const GET = route({
  permission: "session",
  query: hotelQuery,
  handler: async ({ session, query }) => ({ data: await getCorporatePortal().dashboard(session, query) }),
});