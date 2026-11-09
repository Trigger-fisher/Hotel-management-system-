import "server-only";
import { getFrontOfficeStays } from "@/server/compose/frontOffice";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { checkOutBody } from "@/server/services/frontOffice/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// Check-out into a Bill Master bill, in one unit (Pallav maps it to an edit). Money: Idempotency-Key honoured.
export const POST = route({
  permission: { key: "pms.stays", level: "edit" },
  params: idParams,
  body: checkOutBody,
  idempotency: "optional",
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getFrontOfficeStays().checkOut(session, params.id, body, requestMeta(request, traceId)) }),
});
