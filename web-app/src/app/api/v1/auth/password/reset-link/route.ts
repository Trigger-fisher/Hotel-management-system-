import "server-only";
import { z } from "zod";
import { getAuthService } from "@/server/compose/auth";
import { requestMeta } from "@/server/http/meta";
import { publicRoute } from "@/server/http/route";
import { assertHuman } from "@/server/http/turnstile";

// The new password through the emailed link: 200 {done: true}; the link used up, every session of the account ended, an audit row. A link no longer good:
// 404 NOT_FOUND; the password rules: 422 with fields.newPassword.
export const dynamic = "force-dynamic";

export const POST = publicRoute({
  body: z.strictObject({ token: z.string().max(200), newPassword: z.string().max(500) }),
  idempotency: "off",
  limits: [
    { name: "reset-link", max: 10, windowSeconds: 60, by: "ip" },
    { name: "reset-ip", max: 20, windowSeconds: 900, by: "ip" },
  ],
  handler: async ({ body, request, traceId }) => {
    await assertHuman(request);
    return { data: (await getAuthService().resetWithLink(body, requestMeta(request, traceId))).data };
  },
});