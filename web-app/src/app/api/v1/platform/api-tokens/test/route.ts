import "server-only";
import { z } from "zod";
import { getPlatformApiTokens } from "@/server/compose/platform";
import { route } from "@/server/http/route";

// Test an API key (the Set-up centre's API step): the Super Admin pastes the key just shown and gets "This key works for <hotel>" or why not. Super Admin only; the key is never stored or logged.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  body: z.strictObject({ token: z.string().max(200) }),
  idempotency: "off",
  limits: [{ name: "api-token-test", max: 10, windowSeconds: 60, by: "session" }],
  handler: async ({ session, body }) => ({ data: await getPlatformApiTokens().test(session, body.token) }),
});