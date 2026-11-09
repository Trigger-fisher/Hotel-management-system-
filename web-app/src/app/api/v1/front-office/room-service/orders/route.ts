import "server-only";
import { getRoomServiceDesk } from "@/server/compose/roomServiceDesk";
import { route } from "@/server/http/route";
import { requestMeta } from "@/server/http/meta";
import { roomOrderListQuery, roomOrderPlaceBody } from "@/server/services/roomService/schemas";

export const dynamic = "force-dynamic";

// Room service orders (the Guest Desk): `open` = the kitchen's queue, oldest first (the default); a status or `all` = newest first. In House view.
export const GET = route({
  permission: { key: "pms.stays", level: "view" },
  cache: "private, no-cache",
  query: roomOrderListQuery,
  handler: async ({ session, query }) => ({ data: await getRoomServiceDesk().list(session, query) }),
});
// Staff take an order: for a restaurant table, or for an in-house guest's room (charged to the stay). In House edit; logged.
export const POST = route({
  permission: { key: "pms.stays", level: "edit" },
  body: roomOrderPlaceBody,
  handler: async ({ session, body, request, traceId }) => ({ status: 201, data: await getRoomServiceDesk().place(session, body, requestMeta(request, traceId)) }),
});
