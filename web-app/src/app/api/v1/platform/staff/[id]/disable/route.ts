import "server-only";
import { getPlatformStaff } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { hotelIdParams } from "@/server/services/platform/schemas";

// Disables the account and ends its sessions. Platform Admin accounts only; Super Admin only. (docs/BACKEND.md 14.6)
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: hotelIdParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getPlatformStaff().disable(session, params.id, platformMeta(request, traceId)) }),
});