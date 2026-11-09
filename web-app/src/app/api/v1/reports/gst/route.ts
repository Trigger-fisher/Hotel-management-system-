import "server-only";
import { getReports } from "@/server/compose/overview";
import { route } from "@/server/http/route";
import { occupancyQuery } from "@/server/services/overview/schemas";

export const dynamic = "force-dynamic";

// The GST summary of one month (default this month): every live bill with its taxable value and GST per business, B2B and B2C totals.
export const GET = route({
  permission: { key: "reports", level: "view" },
  cache: "private, no-cache",
  query: occupancyQuery,
  handler: async ({ session, query }) => ({ data: await getReports().gst(session, query.month) }),
});
