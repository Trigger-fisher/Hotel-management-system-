import "server-only";
import { getHotelSetup } from "@/server/compose/hotelSetup";
import { route } from "@/server/http/route";
import { testEmailBody } from "@/server/services/admin/schemas";
import { platformMeta } from "@/server/services/platform/access";
import { hotelIdParams } from "@/server/services/platform/schemas";

// Sends one test email through the hotel's own mail server (Set-up centre). Super Admin only.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route({
  permission: "session",
  params: hotelIdParams,
  body: testEmailBody,
  limits: [{ name: "setup-test-email", max: 5, windowSeconds: 60, by: "session" }],
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getHotelSetup().testEmail(session, params.id, body, platformMeta(request, traceId)) }),
});