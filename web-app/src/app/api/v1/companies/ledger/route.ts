import "server-only";
import { getCompanyLedger } from "@/server/compose/companies";
import { route } from "@/server/http/route";
import { ledgerOverviewQuery } from "@/server/services/companies/schemas";

export const dynamic = "force-dynamic";

// Every company with its balance, from one aggregate (no account is rebuilt per request).
export const GET = route({
  permission: { key: "companies.ledger", level: "view" },
  cache: "private, no-cache",
  query: ledgerOverviewQuery,
  handler: async ({ session, query }) => ({ data: await getCompanyLedger().overview(session, query) }),
});
