import "server-only";
import { getAdminUsers } from "@/server/compose/admin";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { portalInviteBody } from "@/server/services/admin/userSchemas";

export const dynamic = "force-dynamic";

// A guest or company portal login for a record of this hotel: made, linked to the record and invited by email (temporary password, first sign-in sets their own).
export const POST = route({
  permission: { key: "users", level: "create" },
  body: portalInviteBody,
  idempotency: "optional",
  handler: async ({ session, body, request, traceId }) => ({ data: await getAdminUsers().invitePortal(session, body, requestMeta(request, traceId)) }),
});
