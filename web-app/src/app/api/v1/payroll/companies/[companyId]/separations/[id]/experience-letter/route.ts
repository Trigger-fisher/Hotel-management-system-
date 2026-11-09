import "server-only";
import { getPayrollLetters } from "@/server/compose/payrollCore";
import { route } from "@/server/http/route";
import { companyItemParams } from "@/server/services/payrollPay/schemas";

export const dynamic = "force-dynamic";

// The experience letter of a person who has left (Relieved, not rejoined).
export const GET = route({
  permission: { key: "payroll.separation", level: "view" },
  params: companyItemParams,
  handler: async ({ session, params }) => ({ data: await getPayrollLetters().experienceLetter(session, params.companyId, params.id) }),
});
