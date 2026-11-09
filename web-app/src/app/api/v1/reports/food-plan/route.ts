import "server-only";
import { getReports } from "@/server/compose/overview";
import { route } from "@/server/http/route";
import { foodPlanQuery } from "@/server/services/overview/schemas";

export const dynamic = "force-dynamic";

// What the hotel owes Pallav Food for plan meals in a month (default this month), guest by guest, optionally one plan.
export const GET = route({
  permission: { key: "reports", level: "view" },
  cache: "private, no-cache",
  query: foodPlanQuery,
  handler: async ({ session, query }) => ({ data: await getReports().foodPlan(session, query.month, query.plan) }),
});
