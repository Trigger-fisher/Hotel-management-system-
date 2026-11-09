import "server-only";
import { route } from "@/server/http/route";
import { requestMeta } from "@/server/http/meta";
import { getAdminAccount } from "@/server/compose/admin";
import { profileBody } from "@/server/services/admin/userSchemas";

export const dynamic = "force-dynamic";

// The signed-in person's own account: any signed-in person, only their own.
export const GET = route({
  permission: "session",
  handler: async ({ session }) => ({ data: await getAdminAccount().profile(session) }),
});

export const PUT = route({
  permission: "session",
  body: profileBody,
  handler: async ({ session, body, request, traceId }) => ({ data: await getAdminAccount().updateProfile(session, body, requestMeta(request, traceId)) }),
});
