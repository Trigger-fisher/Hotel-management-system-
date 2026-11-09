import "server-only";
import { getCompanyLedger } from "@/server/compose/companies";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";
import { statementQuery } from "@/server/services/companies/schemas";

export const dynamic = "force-dynamic";

// The statement of a period: opening, every row with its running balance, closing, totals; at most 5,000 rows.
export const GET = route({
  permission: { key: "companies.ledger", level: "view" },
  cache: "private, no-cache",
  params: idParams,
  query: statementQuery,
  handler: async ({ session, params, query }) => ({ data: await getCompanyLedger().statement(session, params.id, query) }),
});
