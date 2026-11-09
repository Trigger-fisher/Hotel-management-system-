import "server-only";
import { getPlatformMailSafety } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { idParams } from "@/server/validation/listQuery";

// Lifts one suppression (Super Admin): the address may get campaign mail again. The audit row keeps the address and why it was suppressed.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: idParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getPlatformMailSafety().unsuppress(session, params.id, platformMeta(request, traceId)) }),
});
