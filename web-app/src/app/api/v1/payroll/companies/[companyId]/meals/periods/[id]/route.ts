import "server-only";
import { getPayrollMeals } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { companyItemParams, mealStopBody } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

// Sets the day a record ends.
export const PATCH = route({
  permission: { key: "payroll.food-charge", level: "edit" },
  params: companyItemParams,
  body: mealStopBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPayrollMeals().stopMeals(session, params.companyId, params.id, body, requestMeta(request, traceId)) }),
});

// Removes a record (to the recycle bin) in an open month.
export const DELETE = route({
  permission: { key: "payroll.food-charge", level: "full" },
  params: companyItemParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getPayrollMeals().deleteMealPeriod(session, params.companyId, params.id, requestMeta(request, traceId)) }),
});
