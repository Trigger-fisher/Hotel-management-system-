import "server-only";
import { getFrontOfficeStays } from "@/server/compose/frontOffice";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { chargeBody } from "@/server/services/frontOffice/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// A charge on the guest's account, only while in house (the stay is locked for the change).
export const POST = route({
  permission: { key: "pms.stays", level: "create" },
  params: idParams,
  body: chargeBody,
  idempotency: "optional",
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getFrontOfficeStays().addCharge(session, params.id, body, requestMeta(request, traceId)), status: 201 }),
});
