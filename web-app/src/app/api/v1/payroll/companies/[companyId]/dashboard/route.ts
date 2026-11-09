import "server-only";
import { getPayrollCompanies } from "@/server/compose/payrollCore";
import { route } from "@/server/http/route";
import { companyParams } from "@/server/services/payrollCore/schemas";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "payroll.dashboard", level: "view" },
  params: companyParams,
  handler: async ({ session, params }) => ({ data: await getPayrollCompanies().dashboard(session, params.companyId) }),
});
