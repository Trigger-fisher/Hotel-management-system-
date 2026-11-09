import "server-only";
import { route } from "@/server/http/route";
import { requestMeta } from "@/server/http/meta";
import { getAdminUsers } from "@/server/compose/admin";
import { idParams } from "@/server/services/admin/schemas";
import { userBody } from "@/server/services/admin/userSchemas";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "users", level: "view" },
  params: idParams,
  handler: async ({ session, params }) => ({ data: await getAdminUsers().get(session, params.id) }),
});

// Edit the details and the role; a new e-mail address goes through the credential port.
export const PUT = route({
  permission: { key: "users", level: "edit" },
  params: idParams,
  body: userBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getAdminUsers().update(session, params.id, body, requestMeta(request, traceId)) }),
});

// Delete an account (full level; the SuperAdmin cannot be deleted).
export const DELETE = route({
  permission: { key: "users", level: "full" },
  params: idParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getAdminUsers().remove(session, params.id, requestMeta(request, traceId)) }),
});
