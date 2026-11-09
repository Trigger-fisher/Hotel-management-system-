import "server-only";
import { getFrontOfficeRooms } from "@/server/compose/frontOffice";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { housekeepingBody } from "@/server/services/frontOffice/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// Clean or dirty: the status wanted is sent (HMS: set, not toggle).
export const PUT = route({
  permission: { key: "pms.rooms", level: "edit" },
  params: idParams,
  body: housekeepingBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getFrontOfficeRooms().housekeeping(session, params.id, body.hkStatus, requestMeta(request, traceId)) }),
});
