import "server-only";
import { getFrontOfficeRequests } from "@/server/compose/frontOffice";
import { route } from "@/server/http/route";
import { requestListQuery } from "@/server/services/frontOffice/schemas";

export const dynamic = "force-dynamic";

// Guest requests (G2): the queue of what guests asked for from the portal (waiting, oldest first) or the closed ones (newest first). In House view.
export const GET = route({
  permission: { key: "pms.stays", level: "view" },
  cache: "private, no-cache",
  query: requestListQuery,
  handler: async ({ session, query }) => ({ data: await getFrontOfficeRequests().list(session, query) }),
});
