import "server-only";
import { getPayrollStaffEmails } from "@/server/compose/payrollCore";
import { route } from "@/server/http/route";
import { companyParams } from "@/server/services/payrollCore/schemas";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "payroll.staff", level: "view" },
  params: companyParams,
  handler: async ({ session, params }) => ({ data: await getPayrollStaffEmails().recipients(session, params.companyId) }),
});
