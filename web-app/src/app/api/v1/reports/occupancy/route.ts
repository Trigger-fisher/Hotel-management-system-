import "server-only";
import { getReports } from "@/server/compose/overview";
import { route } from "@/server/http/route";
import { occupancyQuery } from "@/server/services/overview/schemas";

export const dynamic = "force-dynamic";

// Occupancy, ADR and RevPAR for one month (default this month, up to today): one row per night from the stays, and the month's totals.
export const GET = route({
  permission: { key: "reports", level: "view" },
  cache: "private, no-cache",
  query: occupancyQuery,
  handler: async ({ session, query }) => ({ data: await getReports().occupancy(session, query.month) }),
});
