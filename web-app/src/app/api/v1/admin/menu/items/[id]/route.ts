import "server-only";
import { getAdminMenu } from "@/server/compose/admin";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { idParams, menuItemEditBody } from "@/server/services/admin/schemas";

// Change one menu item (name, note, price, on or off), or remove it. Master Data (module masters): edit. A removed item changes no bill.
export const dynamic = "force-dynamic";

export const PATCH = route({
  permission: { key: "masters", level: "edit" },
  params: idParams,
  body: menuItemEditBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getAdminMenu().update(session, params.id, body, requestMeta(request, traceId)) }),
});

export const DELETE = route({
  permission: { key: "masters", level: "edit" },
  params: idParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getAdminMenu().remove(session, params.id, requestMeta(request, traceId)) }),
});
