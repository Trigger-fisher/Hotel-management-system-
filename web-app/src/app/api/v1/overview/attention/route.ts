import "server-only";
import { getHotelDashboard } from "@/server/compose/overview";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// The bell on every hotel page: what needs attention now (departures due, no handover yet, open salaries, rooms to clean, arrivals,
// an empty cash book), only the items the person's grants let them act on. A hotel account with the dashboard asks; a portal account never reaches it.
export const GET = route({
  permission: { key: "dashboard", level: "view" },
  touch: false,
  cache: "private, no-cache",
  handler: async ({ session }) => ({ data: await getHotelDashboard().attention(session) }),
});
