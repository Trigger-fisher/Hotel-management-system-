import "server-only";
import { getPayrollPayments } from "@/server/compose/payrollCore";
import { route } from "@/server/http/route";
import { masterParams } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

// Payroll Master choices (else Pallav's defaults); any payroll part's view.
export const GET = route({
  permission: "session",
  params: masterParams,
  handler: async ({ session, params }) => ({ data: await getPayrollPayments().masterChoices(session, params.companyId, params.list) }),
});
