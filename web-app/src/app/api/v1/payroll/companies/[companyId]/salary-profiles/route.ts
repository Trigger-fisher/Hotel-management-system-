import "server-only";
import { getPayrollRevisions } from "@/server/compose/payrollCore";
import { route } from "@/server/http/route";
import { companyParams, profilesQuery } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "payroll.salary-update", level: "view" },
  cache: "private, no-cache",
  params: companyParams,
  query: profilesQuery,
  handler: async ({ session, params, query }) => ({ data: await getPayrollRevisions().listProfiles(session, params.companyId, query) }),
});
