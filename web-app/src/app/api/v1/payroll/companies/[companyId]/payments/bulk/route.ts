import "server-only";
import { getPayrollPayments } from "@/server/compose/payrollCore";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { bulkPaymentBody, companyParams } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

// One status for many salaries (no partial amount), one unit.
export const POST = route({
  permission: { key: "payroll.salary-payment", level: "edit" },
  params: companyParams,
  body: bulkPaymentBody,
  idempotency: "optional",
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPayrollPayments().bulk(session, params.companyId, body, requestMeta(request, traceId)) }),
});
