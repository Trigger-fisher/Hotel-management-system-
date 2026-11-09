import "server-only";
import { getFrontOfficeRooms } from "@/server/compose/frontOffice";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { bulkRoomsBody } from "@/server/services/frontOffice/schemas";

export const dynamic = "force-dynamic";

// "101-110" or "201, 202, 205" (Pallav RoomController::bulk: a create).
export const POST = route({
  permission: { key: "pms.rooms", level: "create" },
  body: bulkRoomsBody,
  handler: async ({ session, body, request, traceId }) => ({ data: await getFrontOfficeRooms().bulk(session, body, requestMeta(request, traceId)), status: 201 }),
});
