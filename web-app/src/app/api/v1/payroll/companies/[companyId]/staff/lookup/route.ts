import "server-only";
import { getPayrollPayments } from "@/server/compose/payrollCore";
import { route } from "@/server/http/route";
import { companyParams, staffLookupQuery } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

// The pay screens' lean staff picker: name or employee-code prefix, at most 50, {id, name, code, designation}. Any payroll part's view (the service checks).
export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  params: companyParams,
  query: staffLookupQuery,
  handler: async ({ session, params, query }) => ({ data: await getPayrollPayments().staffLookup(session, params.companyId, query) }),
});
