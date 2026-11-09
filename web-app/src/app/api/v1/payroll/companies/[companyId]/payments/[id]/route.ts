import "server-only";
import { getPayrollPayments } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { companyItemParams, paymentBody } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

export const PATCH = route({
  permission: { key: "payroll.salary-payment", level: "edit" },
  params: companyItemParams,
  body: paymentBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPayrollPayments().update(session, params.companyId, params.id, body, requestMeta(request, traceId)) }),
});
