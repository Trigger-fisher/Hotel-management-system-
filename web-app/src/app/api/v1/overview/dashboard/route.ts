import "server-only";
import { getHotelDashboard } from "@/server/compose/overview";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// The Hotel dashboard: today and the month from the two cash books, the 30-day trend, spending by head, recent entries, the handover, payroll, what needs attention and the guests arriving today.
export const GET = route({
  permission: { key: "dashboard", level: "view" },
  cache: "private, no-cache",
  handler: async ({ session }) => ({ data: await getHotelDashboard().summary(session) }),
});
