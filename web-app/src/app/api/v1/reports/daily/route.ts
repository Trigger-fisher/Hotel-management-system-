import "server-only";
import { getReports } from "@/server/compose/overview";
import { route } from "@/server/http/route";
import { dailyQuery } from "@/server/services/overview/schemas";

export const dynamic = "force-dynamic";

// The front desk day sheet for one date (default today): cash in and out, the plan meals of the night, online money, bills on credit, and the cash carried forward.
export const GET = route({
  permission: { key: "reports", level: "view" },
  cache: "private, no-cache",
  query: dailyQuery,
  handler: async ({ session, query }) => ({ data: await getReports().daily(session, query.date) }),
});
