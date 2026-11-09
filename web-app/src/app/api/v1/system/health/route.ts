import "server-only";
import { getSystemHealth } from "@/server/compose/systemAdmin";
import { route } from "@/server/http/route";

// System Health (Pallav SystemHealthController::index): the checks (re-run when none is under 5 minutes old), uptime and the open faults. SuperAdmin only.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  handler: async ({ session }) => ({ data: await getSystemHealth().overview(session) }),
});
