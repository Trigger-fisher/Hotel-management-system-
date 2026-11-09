import "server-only";
import { getAdminSettings } from "@/server/compose/admin";
import { groupParams, settingsBody } from "@/server/services/admin/schemas";
import { requestMeta } from "@/server/http/meta";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// Saves one group. A secret left empty keeps what is saved; a toggle not sent reads as off (Pallav reads every field).
export const PATCH = route({
  permission: "session",
  params: groupParams,
  body: settingsBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getAdminSettings().update(session, params.group, body, requestMeta(request, traceId)) }),
});
