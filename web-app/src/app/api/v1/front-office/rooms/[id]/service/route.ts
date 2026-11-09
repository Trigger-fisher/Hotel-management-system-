import "server-only";
import { getFrontOfficeRooms } from "@/server/compose/frontOffice";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { serviceBody } from "@/server/services/frontOffice/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// Out of order with a reason, or back in service.
export const PUT = route({
  permission: { key: "pms.rooms", level: "edit" },
  params: idParams,
  body: serviceBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getFrontOfficeRooms().service(session, params.id, body, requestMeta(request, traceId)) }),
});
