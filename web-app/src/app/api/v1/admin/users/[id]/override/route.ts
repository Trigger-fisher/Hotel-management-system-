import "server-only";
import { route } from "@/server/http/route";
import { requestMeta } from "@/server/http/meta";
import { getAdminUsers } from "@/server/compose/admin";
import { idParams } from "@/server/services/admin/schemas";
import { overrideBody } from "@/server/services/admin/userSchemas";

export const dynamic = "force-dynamic";

// Give or take one screen's level for one person (level null clears the exception). Needs the access screen at edit; the service checks the rest.
export const PUT = route({
  permission: { key: "access", level: "edit" },
  params: idParams,
  body: overrideBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getAdminUsers().setOverride(session, params.id, body, requestMeta(request, traceId)) }),
});
