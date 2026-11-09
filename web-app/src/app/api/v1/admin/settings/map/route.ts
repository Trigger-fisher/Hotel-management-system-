import "server-only";
import { getAdminSettingsMap } from "@/server/compose/admin";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// The Settings home as a map: each area a hotel sets up, with what is there now and where to do it (SuperAdmin only).
export const GET = route({
  permission: "session",
  touch: false,
  handler: async ({ session }) => ({ data: await getAdminSettingsMap().map(session) }),
});
