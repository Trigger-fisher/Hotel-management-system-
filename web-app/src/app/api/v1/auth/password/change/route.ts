import "server-only";
import { newSessionHeaders } from "@/server/auth/tokens";
import { getAuthService } from "@/server/compose/auth";
import { requestMeta } from "@/server/http/meta";
import { publicRoute } from "@/server/http/route";
import { changeBody } from "@/server/services/auth/schemas";

export const dynamic = "force-dynamic";

// A temporary password's one move (AuthController::changePassword): throttle:10,1 (routes/web.php:91). Ends in a signed-in session or the code step.
export const POST = publicRoute({
  body: changeBody,
  idempotency: "off",
  limits: [{ name: "change", max: 10, windowSeconds: 60, by: "ip" }],
  handler: async ({ body, request, traceId }) => {
    const out = await getAuthService().changePassword(body, requestMeta(request, traceId));
    return { data: out.data, headers: out.webToken ? newSessionHeaders(out.webToken) : [] };
  },
});
