import "server-only";
import { getPayrollEmployees } from "@/server/compose/payrollCore";
import { route } from "@/server/http/route";
import { companyParams } from "@/server/services/payrollCore/schemas";

export const dynamic = "force-dynamic";

// The staff form's choices: Payroll Master lists (else Pallav's defaults), shifts, deductions, phone countries.
export const GET = route({
  permission: { key: "payroll.staff", level: "view" },
  params: companyParams,
  handler: async ({ session, params }) => ({ data: await getPayrollEmployees().options(session, params.companyId) }),
});
