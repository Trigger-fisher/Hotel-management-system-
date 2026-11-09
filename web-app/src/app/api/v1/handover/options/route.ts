import "server-only";
import { getHandovers } from "@/server/compose/handover";
import { route } from "@/server/http/route";

// What the handover form needs: who a shift can be handed to (active staff of both payrolls, one row per person) and the Master Data shifts.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "handover", level: "view" },
  handler: async ({ session }) => ({ data: await getHandovers().options(session) }),
});
