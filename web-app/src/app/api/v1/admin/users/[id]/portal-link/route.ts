import "server-only";
import { route } from "@/server/http/route";
import { requestMeta } from "@/server/http/meta";
import { getAdminUsers } from "@/server/compose/admin";
import { idParams } from "@/server/services/admin/schemas";
import { portalLinkBody } from "@/server/services/admin/userSchemas";

export const dynamic = "force-dynamic";

// Decision 47: link a guest or company portal account to a record of THIS hotel (same hotel only; the record must exist and be active), so its portal opens.
// A hotel Admin with Edit on Users and rank over the account. Audited. Answers the user (with `portal`).
export const PUT = route({
  permission: { key: "users", level: "edit" },
  params: idParams,
  body: portalLinkBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getAdminUsers().portalLink(session, params.id, body, requestMeta(request, traceId)) }),
});

// Unlink: the portal then answers "your account is not linked yet". Answers the user.
export const DELETE = route({
  permission: { key: "users", level: "edit" },
  params: idParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getAdminUsers().portalUnlink(session, params.id, requestMeta(request, traceId)) }),
});