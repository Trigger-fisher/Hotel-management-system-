import "server-only";
import { getSupportDesk } from "@/server/compose/supportDesk";
import { route } from "@/server/http/route";
import { supportListQuery } from "@/server/services/support/schemas";

export const dynamic = "force-dynamic";

// Guest messages (customer support): `open` = waiting for an answer, oldest first (the default); `answered`, `closed` or `all` newest first. In House view.
export const GET = route({
  permission: { key: "pms.stays", level: "view" },
  cache: "private, no-cache",
  query: supportListQuery,
  handler: async ({ session, query }) => ({ data: await getSupportDesk().list(session, query) }),
});