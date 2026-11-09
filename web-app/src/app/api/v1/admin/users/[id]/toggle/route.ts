import "server-only";
import { route } from "@/server/http/route";
import { requestMeta } from "@/server/http/meta";
import { getAdminUsers } from "@/server/compose/admin";
import { idParams } from "@/server/services/admin/schemas";

export const dynamic = "force-dynamic";

export const POST = route({
  permission: { key: "users", level: "edit" },
  params: idParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getAdminUsers().toggle(session, params.id, requestMeta(request, traceId)) }),
});
