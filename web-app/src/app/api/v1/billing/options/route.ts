import "server-only";
import { getBillingBills } from "@/server/compose/billing";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// The bill form's lists: the hotel's plans with today's meal rate, and the payment modes (replaces the apps' constants).
export const GET = route({
  permission: { key: "bills.bills", level: "view" },
  handler: async ({ session }) => ({ data: await getBillingBills().options(session) }),
});
