import "server-only";
import { getAdminAccount } from "@/server/compose/admin";
import { route } from "@/server/http/route";
import { signInQuery } from "@/server/services/admin/userSchemas";

export const dynamic = "force-dynamic";

// The signed-in person's sign-in history: search, one address singled out, paged.
export const GET = route({
  permission: "session",
  query: signInQuery,
  handler: async ({ session, query }) => ({ data: await getAdminAccount().signIns(session, query) }),
});
