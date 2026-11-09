import "server-only";
import { getCompanyLedger } from "@/server/compose/companies";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";
import { accountQuery } from "@/server/services/companies/schemas";

export const dynamic = "force-dynamic";

// One company's account, written like a book: it opens on the last page.
export const GET = route({
  permission: { key: "companies.ledger", level: "view" },
  cache: "private, no-cache",
  params: idParams,
  query: accountQuery,
  handler: async ({ session, params, query }) => ({ data: await getCompanyLedger().account(session, params.id, query) }),
});
