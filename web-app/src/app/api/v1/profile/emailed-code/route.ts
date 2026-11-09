import "server-only";
import { getAdminAccount } from "@/server/compose/admin";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { emailedCodeBody } from "@/server/services/admin/userSchemas";

export const dynamic = "force-dynamic";

// The signed-in person switches their OWN emailed sign-in code on or off (a SET, `{on}`). Every account may switch it (decision 46); turning it OFF needs the current password.
export const PUT = route({
  permission: "session",
  body: emailedCodeBody,
  idempotency: "off",
  handler: async ({ session, body, request, traceId }) => ({ data: await getAdminAccount().setEmailedCode(session, body, requestMeta(request, traceId)) }),
});
