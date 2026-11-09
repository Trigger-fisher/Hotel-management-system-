import "server-only";
import { getPayrollRevisions } from "@/server/compose/payrollCore";
import { route } from "@/server/http/route";
import { employeeParams } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "payroll.salary-update", level: "view" },
  params: employeeParams,
  handler: async ({ session, params }) => ({ data: await getPayrollRevisions().profile(session, params.companyId, params.employeeId) }),
});
