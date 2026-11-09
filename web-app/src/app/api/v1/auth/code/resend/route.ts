import "server-only";
import { getAuthService } from "@/server/compose/auth";
import { publicRoute } from "@/server/http/route";
import { challengeBody } from "@/server/services/auth/schemas";

export const dynamic = "force-dynamic";

// "Send a new code" (AuthController::resend): throttle:6,1 (routes/web.php:81).
export const POST = publicRoute({
  body: challengeBody,
  idempotency: "off",
  limits: [{ name: "resend", max: 6, windowSeconds: 60, by: "ip" }],
  handler: async ({ body }) => ({ data: (await getAuthService().resendCode(body)).data }),
});
