import "server-only";
import { getPayrollEmployees } from "@/server/compose/payrollCore";
import { route } from "@/server/http/route";
import { companyParams, lookupQuery } from "@/server/services/payrollCore/schemas";

export const dynamic = "force-dynamic";

// The staff picker: name or employee-code prefix, at most 50.
export const GET = route({
  permission: { key: "payroll.staff", level: "view" },
  cache: "private, no-cache",
  params: companyParams,
  query: lookupQuery,
  handler: async ({ session, params, query }) => ({ data: await getPayrollEmployees().lookup(session, params.companyId, query) }),
});
