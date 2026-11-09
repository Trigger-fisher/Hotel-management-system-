import "server-only";
import { getPayrollCompanies } from "@/server/compose/payrollCore";
import { route } from "@/server/http/route";
import { companyListQuery } from "@/server/services/payrollCore/schemas";

export const dynamic = "force-dynamic";

// The fixed payroll companies in their fixed order; `search` (words over name, code, owner) narrows them; any payroll part's view (checked by the service).
export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  query: companyListQuery,
  handler: async ({ session, query }) => ({ data: await getPayrollCompanies().list(session, query.search) }),
});
