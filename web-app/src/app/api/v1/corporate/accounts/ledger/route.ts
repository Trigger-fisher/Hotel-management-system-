import "server-only";
import { getCorporatePortal } from "@/server/compose/portal";
import { route } from "@/server/http/route";
import { accountsLedgerQuery } from "@/server/services/corporate/schemas";

export const dynamic = "force-dynamic";

// Decision 48, Accounts > Ledger: the running statement (date, what, debit, credit, balance), each row with a drop-down `detail`; the balance runs within each hotel.
export const GET = route({
  permission: "session",
  query: accountsLedgerQuery,
  handler: async ({ session, query }) => ({ data: await getCorporatePortal().ledgerPage(session, query) }),
});