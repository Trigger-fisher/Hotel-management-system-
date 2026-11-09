import "server-only";
import { route } from "@/server/http/route";
import { requestMeta } from "@/server/http/meta";
import { getAdminRoles } from "@/server/compose/admin";
import { idParams } from "@/server/services/admin/schemas";
import { roleBody } from "@/server/services/admin/userSchemas";

export const dynamic = "force-dynamic";

export const PUT = route({
  permission: { key: "access", level: "edit" },
  params: idParams,
  body: roleBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getAdminRoles().update(session, params.id, body, requestMeta(request, traceId)) }),
});

export const DELETE = route({
  permission: { key: "access", level: "edit" },
  params: idParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getAdminRoles().remove(session, params.id, requestMeta(request, traceId)) }),
});
