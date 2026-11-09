import "server-only";
import { getPayrollPayments } from "@/server/compose/payrollCore";
import { route } from "@/server/http/route";
import { companyParams, slipsQuery } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "payroll.salary-slip", level: "view" },
  cache: "private, no-cache",
  params: companyParams,
  query: slipsQuery,
  handler: async ({ session, params, query }) => ({ data: await getPayrollPayments().slips(session, params.companyId, query) }),
});
