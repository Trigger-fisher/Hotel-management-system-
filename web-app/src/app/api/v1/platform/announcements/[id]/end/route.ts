import "server-only";
import { getPlatformAnnouncements } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { idParams } from "@/server/validation/listQuery";

// Ends an announcement now (Super Admin only, audited): it leaves every dashboard at once; 409 when it is already over.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: idParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getPlatformAnnouncements().end(session, params.id, platformMeta(request, traceId)) }),
});
