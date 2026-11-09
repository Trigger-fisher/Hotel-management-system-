import "server-only";
import { getPlatformArchive } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { deleteBody, hotelIdParams } from "@/server/services/platform/schemas";

// Deletes an archived hotel for good: grace period over, a ready export, the address typed exactly. Super Admin only. (docs/BACKEND.md 14.6)
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = route({
  permission: "session",
  params: hotelIdParams,
  body: deleteBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getPlatformArchive().deletePermanently(session, params.id, body.confirmSlug, platformMeta(request, traceId)) }),
});