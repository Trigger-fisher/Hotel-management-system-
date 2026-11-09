import "server-only";
import { getAdminBackup } from "@/server/compose/admin";
import { route } from "@/server/http/route";

// Connect with Google (stub: 409 "Save the Google client ID and secret first ..." or "not available on this server yet"). SuperAdmin only.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  handler: async ({ session }) => ({ data: await getAdminBackup().connect(session) }),
});