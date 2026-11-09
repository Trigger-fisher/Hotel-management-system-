import "server-only";
import { getPlatformApiTokens } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { idParams } from "@/server/validation/listQuery";

// Revokes one API access key at once (Super Admin, browser only). The row stays, marked revoked, for the audit trail.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: idParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getPlatformApiTokens().revoke(session, params.id, platformMeta(request, traceId)) }),
});