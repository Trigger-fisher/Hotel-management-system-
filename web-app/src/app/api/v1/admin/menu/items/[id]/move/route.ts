import "server-only";
import { getAdminMenu } from "@/server/compose/admin";
import { route } from "@/server/http/route";
import { directionBody, idParams } from "@/server/services/admin/schemas";

// Move a menu item one place up or down inside its group. Master Data (module masters): edit.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: { key: "masters", level: "edit" },
  params: idParams,
  body: directionBody,
  handler: async ({ session, params, body }) => ({ data: await getAdminMenu().move(session, params.id, body.direction) }),
});
