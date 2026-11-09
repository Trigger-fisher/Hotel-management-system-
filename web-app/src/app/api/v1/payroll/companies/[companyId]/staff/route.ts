import "server-only";
import { getPayrollPayments } from "@/server/compose/payrollCore";
import { route } from "@/server/http/route";
import { companyParams, employeesQuery } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

// The pay screens' staff picker; any payroll part's view (checked by the service).
export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  params: companyParams,
  query: employeesQuery,
  handler: async ({ session, params, query }) => ({ data: await getPayrollPayments().employees(session, params.companyId, query.activeOnly) }),
});
