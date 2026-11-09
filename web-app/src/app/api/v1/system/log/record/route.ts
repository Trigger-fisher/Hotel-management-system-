import "server-only";
import { getSystemLogs } from "@/server/compose/systemAdmin";
import { route } from "@/server/http/route";
import { recordHistoryQuery } from "@/server/services/systemAdmin/schemas";

// The history of one record ("who changed this bill and when"): the system-log lines about that id, only from modules the person may view.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  query: recordHistoryQuery,
  touch: false,
  handler: async ({ session, query }) => ({ data: await getSystemLogs().recordHistory(session, query.id) }),
});
