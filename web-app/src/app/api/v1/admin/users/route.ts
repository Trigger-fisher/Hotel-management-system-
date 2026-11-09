import "server-only";
import { route } from "@/server/http/route";
import { requestMeta } from "@/server/http/meta";
import { getAdminUsers } from "@/server/compose/admin";
import { userBody, userListQuery } from "@/server/services/admin/userSchemas";

export const dynamic = "force-dynamic";

// The accounts of this hotel: searchable, filtered by tab, paged. Needs the users screen at view.
export const GET = route({
  permission: { key: "users", level: "view" },
  cache: "private, no-cache",
  query: userListQuery,
  handler: async ({ session, query }) => ({ data: await getAdminUsers().list(session, query) }),
});

// A new account; the sign-in invitation goes by e-mail through the credential port. The role must be below the caller's own.
export const POST = route({
  permission: { key: "users", level: "create" },
  body: userBody,
  idempotency: "optional",
  handler: async ({ session, body, request, traceId }) => ({ data: await getAdminUsers().create(session, body, requestMeta(request, traceId)) }),
});
