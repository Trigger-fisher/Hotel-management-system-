import "server-only";
import { getPayrollMeals } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { companyItemParams } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

// A price in an open month; the days it covered fall back to the one before.
export const DELETE = route({
  permission: { key: "payroll.food-price", level: "full" },
  params: companyItemParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getPayrollMeals().deletePrice(session, params.companyId, params.id, requestMeta(request, traceId)) }),
});
