import "server-only";
import { getAdminBooks } from "@/server/compose/admin";
import { route } from "@/server/http/route";
import { listSearchQuery } from "@/server/services/admin/schemas";

export const dynamic = "force-dynamic";

// The accounting years: what each holds, what the last one left open, and whether the next can be started or the newest removed. Admins only (the service refuses others).
export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  query: listSearchQuery,
  handler: async ({ session, query }) => ({ data: await getAdminBooks().panel(session, query.search) }),
});
