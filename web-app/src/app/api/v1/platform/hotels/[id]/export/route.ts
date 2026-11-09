import "server-only";
import { getPlatformArchive } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { hotelIdParams } from "@/server/services/platform/schemas";

// Packs every record of the hotel into one stored file (any hotel status); audited. Super Admin only. (docs/BACKEND.md 14.6)
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = route({
  permission: "session",
  params: hotelIdParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getPlatformArchive().exportData(session, params.id, platformMeta(request, traceId)) }),
});