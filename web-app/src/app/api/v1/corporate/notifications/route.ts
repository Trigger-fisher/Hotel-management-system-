import "server-only";
import { getCorporatePortal } from "@/server/compose/portal";
import { route } from "@/server/http/route";
import { portalNotificationQuery } from "@/server/services/notifications/schemas";

export const dynamic = "force-dynamic";

// The notifications the hotels sent to this company, newest first; one hotel or all; `unread=true` for the ones not read yet.
export const GET = route({
  permission: "session",
  query: portalNotificationQuery,
  handler: async ({ session, query }) => ({ data: await getCorporatePortal().notifications(session, query) }),
});
