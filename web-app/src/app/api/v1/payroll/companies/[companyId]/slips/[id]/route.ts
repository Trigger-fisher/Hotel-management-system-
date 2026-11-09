import "server-only";
import { getPayrollPayments } from "@/server/compose/payrollCore";
import { route } from "@/server/http/route";
import { companyItemParams } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "payroll.salary-slip", level: "view" },
  params: companyItemParams,
  handler: async ({ session, params }) => ({ data: await getPayrollPayments().slip(session, params.companyId, params.id) }),
});
