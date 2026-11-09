import "server-only";
import { getAuthService } from "@/server/compose/auth";
import { requestMeta } from "@/server/http/meta";
import { publicRoute } from "@/server/http/route";
import { assertHuman } from "@/server/http/turnstile";
import { forgotBody } from "@/server/services/auth/schemas";

export const dynamic = "force-dynamic";

// Forgot password, step one (AuthController::sendResetCode): throttle:10,1 and 10 per 15 minutes per address (routes/web.php:85, AuthController.php:464-468).
// ALWAYS the same answer (MJ #13).
export const POST = publicRoute({
  body: forgotBody,
  idempotency: "off",
  limits: [
    { name: "forgot", max: 10, windowSeconds: 60, by: "ip" },
    { name: "reset-ip", max: 10, windowSeconds: 900, by: "ip" },
  ],
  handler: async ({ body, request, traceId }) => {
    await assertHuman(request);
    return { data: (await getAuthService().forgotPassword(body, requestMeta(request, traceId))).data };
  },
});
