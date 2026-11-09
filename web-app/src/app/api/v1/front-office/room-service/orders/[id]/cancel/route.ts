import "server-only";
import { getRoomServiceDesk } from "@/server/compose/roomServiceDesk";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { roomOrderCancelBody } from "@/server/services/roomService/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// Cancels an order until it is delivered, with a reason the guest sees; its charges come off the room bill. In House edit; logged.
export const POST = route({
  permission: { key: "pms.stays", level: "edit" },
  params: idParams,
  body: roomOrderCancelBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getRoomServiceDesk().cancel(session, params.id, body.reason, requestMeta(request, traceId)) }),
});