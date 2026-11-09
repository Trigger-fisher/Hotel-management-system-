import "server-only";
import { getBillingBills } from "@/server/compose/billing";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// The bill as it prints: the paper's fields as data for the screen and the print view (no PDF library, MJ).
export const GET = route({
  permission: { key: "bills.bills", level: "view" },
  params: idParams,
  handler: async ({ session, params }) => ({ data: await getBillingBills().preview(session, params.id) }),
});
