import "server-only";
import { getFrontOfficeRooms } from "@/server/compose/frontOffice";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { roomBody } from "@/server/services/frontOffice/schemas";
import { idParams } from "@/server/validation/listQuery";

export const dynamic = "force-dynamic";

export const PATCH = route({
  permission: { key: "pms.rooms", level: "edit" },
  params: idParams,
  body: roomBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getFrontOfficeRooms().update(session, params.id, body, requestMeta(request, traceId)) }),
});

// A hard delete, only for a room no stay names (Pallav has no recycle bin for rooms).
export const DELETE = route({
  permission: { key: "pms.rooms", level: "full" },
  params: idParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getFrontOfficeRooms().remove(session, params.id, requestMeta(request, traceId)) }),
});
