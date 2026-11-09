import "server-only";
import { getPayrollPayments } from "@/server/compose/payrollCore";
import { route } from "@/server/http/route";
import { companyParams } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

// The months processed, newest first; any payroll part's view.
export const GET = route({
  permission: "session",
  params: companyParams,
  handler: async ({ session, params }) => ({ data: await getPayrollPayments().periods(session, params.companyId) }),
});
