import "server-only";
import { getAdminAccount } from "@/server/compose/admin";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { signInCodeBody } from "@/server/services/admin/userSchemas";

export const dynamic = "force-dynamic";

// Decision 46 (MJ, 12 Oct 2026): the person switches the emailed sign-in code on or off for their OWN account (`{enabled, password?}`; every role, administrators too;
// default off). ON needs nothing extra (and an email address); OFF needs the current password (wrong = 401 INVALID_CREDENTIALS on `password`, counted like a wrong
// sign-in; five wrong tries lock the account the same way). Nobody can change another person's switch. Answers the profile, with `codeRequired`.
export const PUT = route({
  permission: "session",
  body: signInCodeBody,
  idempotency: "off",
  handler: async ({ session, body, request, traceId }) => ({ data: await getAdminAccount().setSignInCode(session, body, requestMeta(request, traceId)) }),
});
