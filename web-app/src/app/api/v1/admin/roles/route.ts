import "server-only";
import { route } from "@/server/http/route";
import { requestMeta } from "@/server/http/meta";
import { getAdminRoles } from "@/server/compose/admin";
import { roleBody } from "@/server/services/admin/userSchemas";
import { listSearchQuery } from "@/server/services/admin/schemas";

export const dynamic = "force-dynamic";

export const GET = route({
  permission: { key: "access", level: "view" },
  cache: "private, no-cache",
  query: listSearchQuery,
  handler: async ({ session, query }) => ({ data: await getAdminRoles().list(session, query.search) }),
});

export const POST = route({
  permission: { key: "access", level: "edit" },
  body: roleBody,
  idempotency: "optional",
  handler: async ({ session, body, request, traceId }) => ({ data: await getAdminRoles().create(session, body, requestMeta(request, traceId)) }),
});
