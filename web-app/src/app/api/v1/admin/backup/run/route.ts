import "server-only";
import { getAdminBackup } from "@/server/compose/admin";
import { route } from "@/server/http/route";

// Back up now (stub: 409 not connected / not available yet). SuperAdmin only.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  handler: async ({ session }) => ({ data: await getAdminBackup().run(session) }),
});