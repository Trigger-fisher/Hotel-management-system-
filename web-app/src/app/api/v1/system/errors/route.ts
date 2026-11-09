import "server-only";
import { getSystemHealth } from "@/server/compose/systemAdmin";
import { route } from "@/server/http/route";
import { errorsQuery } from "@/server/services/systemAdmin/schemas";

// The faults the features raised (SystemHealthController::errors): open, resolved or all, optionally one feature. SuperAdmin only.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  query: errorsQuery,
  handler: async ({ session, query }) => ({ data: await getSystemHealth().errors(session, query) }),
});
