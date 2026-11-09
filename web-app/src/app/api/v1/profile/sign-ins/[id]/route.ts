import "server-only";
import { route } from "@/server/http/route";
import { requestMeta } from "@/server/http/meta";
import { getAdminAccount } from "@/server/compose/admin";
import { signInIdParams } from "@/server/services/admin/userSchemas";

export const dynamic = "force-dynamic";

// Remove one ENDED sign-in from the person's own history.
export const DELETE = route({
  permission: "session",
  params: signInIdParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getAdminAccount().deleteSignIn(session, params.id, requestMeta(request, traceId)) }),
});
