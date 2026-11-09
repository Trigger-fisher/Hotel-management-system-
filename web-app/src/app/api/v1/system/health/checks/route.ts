import "server-only";
import { getSystemHealth } from "@/server/compose/systemAdmin";
import { route } from "@/server/http/route";

// Runs every check now instead of waiting (SystemHealthController::check). SuperAdmin only.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  handler: async ({ session }) => ({ data: await getSystemHealth().runChecks(session) }),
});
