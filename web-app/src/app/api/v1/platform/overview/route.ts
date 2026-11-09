import "server-only";
import { getPlatformHotels } from "@/server/compose/platform";
import { route } from "@/server/http/route";

// The Platform dashboard: tiles, the newest hotels, what needs attention (docs/BACKEND.md 14.1). Platform Admin and Super Admin.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  handler: async ({ session }) => ({ data: await getPlatformHotels().overview(session) }),
});