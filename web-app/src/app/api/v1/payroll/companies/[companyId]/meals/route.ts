import "server-only";
import { getPayrollMeals } from "@/server/compose/payrollCore";
import { route } from "@/server/http/route";
import { companyParams, mealsQuery } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

// The Staff Meals page: this month unless another is asked for; the live bill, the price history, who is on meals. Food price or food charge view (checked by the service).
export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  params: companyParams,
  query: mealsQuery,
  handler: async ({ session, params, query }) => ({ data: await getPayrollMeals().overview(session, params.companyId, query.period, query.search) }),
});
