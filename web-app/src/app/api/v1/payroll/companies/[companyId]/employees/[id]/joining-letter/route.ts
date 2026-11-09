import "server-only";
import { getPayrollLetters } from "@/server/compose/payrollCore";
import { route } from "@/server/http/route";
import { companyItemParams } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

// The joining letter for one person with the placeholders replaced.
export const GET = route({
  permission: { key: "payroll.joining-letter", level: "view" },
  params: companyItemParams,
  handler: async ({ session, params }) => ({ data: await getPayrollLetters().joiningLetter(session, params.companyId, params.id) }),
});
