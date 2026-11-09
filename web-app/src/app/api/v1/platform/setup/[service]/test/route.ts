import "server-only";
import { getSetupCentre } from "@/server/compose/hotelSetup";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { setupServiceParams, setupTestBody } from "@/server/services/platform/schemas";

// Test one outside service and answer in plain words with the fix. Super Admin only; the demo answers simulated; on the real server it runs only when the Super Admin presses Test.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route({
  permission: "session",
  params: setupServiceParams,
  body: setupTestBody,
  idempotency: "off",
  limits: [{ name: "setup-test", max: 10, windowSeconds: 60, by: "session" }],
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getSetupCentre().test(session, params.service, body, platformMeta(request, traceId)) }),
});