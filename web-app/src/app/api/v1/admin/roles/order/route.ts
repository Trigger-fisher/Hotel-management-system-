import "server-only";
import { getAdminRoles } from "@/server/compose/admin";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { roleOrderBody } from "@/server/services/admin/userSchemas";

export const dynamic = "force-dynamic";

// The ladder reordered (AccessController::reorder): `{order}` names every role once, SuperAdmin first. A static segment, so it never meets roles/[id].
export const PUT = route({
  permission: { key: "access", level: "edit" },
  body: roleOrderBody,
  handler: async ({ session, body, request, traceId }) => ({ data: await getAdminRoles().reorder(session, body, requestMeta(request, traceId)) }),
});
