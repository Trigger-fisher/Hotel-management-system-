import "server-only";
import { getPayrollMeals } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { companyParams, mealPriceBody } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

// Pallav Food only: today or earlier, in an open month; the same day replaces.
export const POST = route({
  permission: { key: "payroll.food-price", level: "edit" },
  params: companyParams,
  body: mealPriceBody,
  idempotency: "optional",
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPayrollMeals().addPrice(session, params.companyId, body, requestMeta(request, traceId)) }),
});
