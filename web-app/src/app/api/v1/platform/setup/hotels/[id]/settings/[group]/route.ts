import "server-only";
import { getHotelSetup } from "@/server/compose/hotelSetup";
import { route } from "@/server/http/route";
import { settingsBody } from "@/server/services/admin/schemas";
import { platformMeta } from "@/server/services/platform/access";
import { hotelSetupGroupParams } from "@/server/services/platform/schemas";

// One hotel's mail server, online payments (hotel, food) or backup, from the Set-up centre. Super Admin only; secrets are never sent back, only whether one is saved.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  params: hotelSetupGroupParams,
  handler: async ({ session, params }) => ({ data: await getHotelSetup().settings(session, params.id, params.group) }),
});

export const PATCH = route({
  permission: "session",
  params: hotelSetupGroupParams,
  body: settingsBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getHotelSetup().saveSettings(session, params.id, params.group, body, platformMeta(request, traceId)) }),
});