import "server-only";
import { getAdminAccount } from "@/server/compose/admin";
import { route } from "@/server/http/route";
import { listSearchQuery } from "@/server/services/admin/schemas";

export const dynamic = "force-dynamic";

// Where the signed-in person is signed in now (read only).
export const GET = route({
  permission: "session",
  query: listSearchQuery,
  handler: async ({ session, query }) => ({ data: await getAdminAccount().devices(session, query.search) }),
});
