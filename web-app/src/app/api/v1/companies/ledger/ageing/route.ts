import "server-only";
import { getCompanyLedger } from "@/server/compose/companies";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// Receivables by age: what each company still owes on its bills, in 30-day buckets from the bill date.
export const GET = route({
  permission: { key: "companies.ledger", level: "view" },
  handler: async ({ session }) => ({ data: await getCompanyLedger().ageing(session) }),
});
