import "server-only";
import { getBillingBills } from "@/server/compose/billing";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { versionBody } from "@/server/services/billing/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// Recycle bin: SuperAdmin only (Pallav RecycleBinController).
export const POST = route({
  permission: "session",
  params: idParams,
  body: versionBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getBillingBills().restore(session, params.id, body.version, requestMeta(request, traceId)) }),
});
