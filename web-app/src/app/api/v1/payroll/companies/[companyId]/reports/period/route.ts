import "server-only";
import { getPayrollPayments } from "@/server/compose/payrollCore";
import { route } from "@/server/http/route";
import { companyParams, periodReportQuery } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "payroll.period-report", level: "view" },
  cache: "private, no-cache",
  params: companyParams,
  query: periodReportQuery,
  handler: async ({ session, params, query }) => ({ data: await getPayrollPayments().periodReport(session, params.companyId, query) }),
});
