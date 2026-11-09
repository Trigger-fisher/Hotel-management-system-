import "server-only";
import { getSystemLogs } from "@/server/compose/systemAdmin";
import { route } from "@/server/http/route";
import { forceLogQuery } from "@/server/services/systemAdmin/schemas";

// The Force Log (Pallav ForceLogController::index): only what was done with force mode armed. The hotel's SuperAdmin only, checked by the service.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  query: forceLogQuery,
  handler: async ({ session, query }) => ({ data: await getSystemLogs().forceLog(session, query) }),
});
