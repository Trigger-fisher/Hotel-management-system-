import "server-only";
import { directionBody, idParams } from "@/server/services/admin/schemas";
import { getAdminMasters } from "@/server/compose/admin";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// Swaps places with its neighbour; at an end nothing happens.
export const POST = route({
  permission: { key: "masters", level: "edit" },
  params: idParams,
  body: directionBody,
  handler: async ({ session, params, body }) => ({ data: await getAdminMasters().moveItem(session, params.id, body.direction) }),
});
