import "server-only";
import { getPlatformHealth } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";

// Runs the health check now; audited. Super Admin only. (docs/BACKEND.md 14.6)
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  handler: async ({ session, request, traceId }) => ({ data: await getPlatformHealth().check(session, platformMeta(request, traceId)) }),
});