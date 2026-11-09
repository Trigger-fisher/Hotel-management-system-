import "server-only";
import { getRoomServiceDesk } from "@/server/compose/roomServiceDesk";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { roomOrderStatusBody } from "@/server/services/roomService/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

// Moves an order forward (accepted, preparing, on the way, delivered; a step may be skipped, never undone: 409). In House edit; logged.
export const POST = route({
  permission: { key: "pms.stays", level: "edit" },
  params: idParams,
  body: roomOrderStatusBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getRoomServiceDesk().setStatus(session, params.id, body.status, requestMeta(request, traceId)) }),
});