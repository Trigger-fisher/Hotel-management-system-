import "server-only";
import { getBillingAdvances } from "@/server/compose/billing";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// Advances with money left, for the "take off an advance" picker on a new bill.
export const GET = route({
  permission: { key: "bills.advances", level: "view" },
  handler: async ({ session }) => ({ data: await getBillingAdvances().open(session) }),
});
