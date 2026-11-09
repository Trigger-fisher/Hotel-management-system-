import "server-only";
import { getPayrollMeals } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { employeeParams, mealPeriodBody } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

// Starts a meals record for one person from this day, optionally to that day.
export const POST = route({
  permission: { key: "payroll.food-charge", level: "create" },
  params: employeeParams,
  body: mealPeriodBody,
  idempotency: "optional",
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPayrollMeals().startMeals(session, params.companyId, params.employeeId, body, requestMeta(request, traceId)), status: 201 }),
});
