import "server-only";
import { after } from "next/server";
import { newSessionHeaders } from "@/server/auth/tokens";
import { getAuthService } from "@/server/compose/auth";
import { requestMeta } from "@/server/http/meta";
import { publicRoute } from "@/server/http/route";
import { assertHuman } from "@/server/http/turnstile";
import { signInBody } from "@/server/services/auth/schemas";

export const dynamic = "force-dynamic";

// Step one (Pallav AuthController::login). Pallav throttles it twice: throttle:30,1 on the route and 20 tries per 15 minutes per address in
// the controller, cleared by a good sign-in (routes/web.php:76, AuthController.php:67-72,96).
export const POST = publicRoute({
  body: signInBody,
  idempotency: "off",
  limits: [
    { name: "login", max: 30, windowSeconds: 60, by: "ip" },
    { name: "login-ip", max: 20, windowSeconds: 900, by: "ip" },
  ],
  handler: async ({ body, request, traceId, failAfterCommit, clearLimit }) => {
    await assertHuman(request);
    const out = await getAuthService().signIn(body, requestMeta(request, traceId), failAfterCommit);
    // the password was right (Pallav clears the per-address counter here, AuthController.php:96): after the answer has gone (sign-in speed, 18 Oct 2026), so the person
    // does not wait for it; where there is no request scope to run it later (tests, scripts) it runs now, as before
    const clear = () => clearLimit("login-ip");
    try {
      after(clear);
    } catch {
      await clear();
    }
    return { data: out.data, headers: out.webToken ? newSessionHeaders(out.webToken) : [] };
  },
});
