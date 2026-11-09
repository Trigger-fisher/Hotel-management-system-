import "server-only";
import { getPlatformHealth } from "@/server/compose/platform";
import { route } from "@/server/http/route";

// Platform health of every live hotel. Super Admin only. (docs/BACKEND.md 14.6)
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  handler: async ({ session }) => ({ data: await getPlatformHealth().get(session) }),
});