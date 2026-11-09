import "server-only";
import { getPayrollPayments } from "@/server/compose/payrollCore";
import { route } from "@/server/http/route";
import { companyParams, periodQuery } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "payroll.monthly-report", level: "view" },
  cache: "private, no-cache",
  params: companyParams,
  query: periodQuery,
  handler: async ({ session, params, query }) => ({ data: await getPayrollPayments().monthlyReport(session, params.companyId, query.period, query.search) }),
});
