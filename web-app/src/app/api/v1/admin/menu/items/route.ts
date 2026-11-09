import "server-only";
import { getAdminMenu } from "@/server/compose/admin";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { menuItemBody } from "@/server/services/admin/schemas";

// A new menu item at the end of its group. Master Data (module masters): edit. 422 with a field (name, note, pricePaise) in plain words.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: { key: "masters", level: "edit" },
  body: menuItemBody,
  handler: async ({ session, body, request, traceId }) => ({ data: await getAdminMenu().create(session, body, requestMeta(request, traceId)), status: 201 }),
});
