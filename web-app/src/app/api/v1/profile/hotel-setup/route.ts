import "server-only";
import { getAuthService } from "@/server/compose/auth";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";
import { hotelSetupBody } from "@/server/services/auth/schemas";

export const dynamic = "force-dynamic";

// The "Set up your hotel" checklist of the signed-in Hotel Admin's hotel (platform.hotel_setup). Anyone else gets `applies: false`.
export const GET = route({
  permission: "session",
  handler: async ({ session }) => ({ data: await getAuthService().getHotelSetup(session) }),
});

// Saves the whole state. "Go live" (`finished`) needs every other step done or skipped, is final and is audited.
export const PUT = route({
  permission: "session",
  body: hotelSetupBody,
  handler: async ({ session, body, request, traceId }) => ({ data: await getAuthService().putHotelSetup(session, body, requestMeta(request, traceId)) }),
});
