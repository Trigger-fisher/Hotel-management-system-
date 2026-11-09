import "server-only";
import { getSystemLogs } from "@/server/compose/systemAdmin";
import { route } from "@/server/http/route";
import { systemLogQuery } from "@/server/services/systemAdmin/schemas";

// The System Log (Pallav SystemLogController::index): the hotel's SuperAdmin only, checked by the service.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  query: systemLogQuery,
  handler: async ({ session, query }) => ({ data: await getSystemLogs().systemLog(session, query) }),
});
