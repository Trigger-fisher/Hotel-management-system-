import "server-only";
import { newSessionHeaders } from "@/server/auth/tokens";
import { getAuthService } from "@/server/compose/auth";
import { requestMeta } from "@/server/http/meta";
import { publicRoute } from "@/server/http/route";
import { verifyCodeBody } from "@/server/services/auth/schemas";

export const dynamic = "force-dynamic";

// Step two (AuthController::verify): throttle:30,1 (routes/web.php:80).
export const POST = publicRoute({
  body: verifyCodeBody,
  idempotency: "off",
  limits: [{ name: "verify", max: 30, windowSeconds: 60, by: "ip" }],
  handler: async ({ body, request, traceId, failAfterCommit }) => {
    const out = await getAuthService().verifyCode(body, requestMeta(request, traceId), failAfterCommit);
    return { data: out.data, headers: out.webToken ? newSessionHeaders(out.webToken) : [] };
  },
});
