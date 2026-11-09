import "server-only";
import { getCorporatePortal } from "@/server/compose/portal";
import { route } from "@/server/http/route";
import { accountsListQuery } from "@/server/services/corporate/schemas";

export const dynamic = "force-dynamic";

// Decision 48, Accounts > Due bills: the open bills with a balance, oldest first, each row with a drop-down `detail`; one hotel or all.
export const GET = route({
  permission: "session",
  query: accountsListQuery,
  handler: async ({ session, query }) => ({ data: await getCorporatePortal().dueBills(session, query) }),
});