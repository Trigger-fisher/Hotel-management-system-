import "server-only";
import { getAdminUsers } from "@/server/compose/admin";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// The roles the caller may give to a new account (every rung below their own).
export const GET = route({
  permission: { key: "users", level: "create" },
  handler: async ({ session }) => ({ data: await getAdminUsers().assignableRoles(session) }),
});
