import "server-only";
import { getAdminRecycle } from "@/server/compose/admin";
import { route } from "@/server/http/route";
import { recycleQuery } from "@/server/services/admin/schemas";

export const dynamic = "force-dynamic";

// Everything deleted in the last N days (Settings: recycle.days), newest deletion first. The hotel's SuperAdmin only (the service refuses others).
export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  query: recycleQuery,
  handler: async ({ session, query }) => ({ data: await getAdminRecycle().list(session, query) }),
});
