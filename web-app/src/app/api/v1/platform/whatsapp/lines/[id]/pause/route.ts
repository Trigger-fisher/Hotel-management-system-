import "server-only";
import { getWhatsAppConnections } from "@/server/compose/whatsappConnections";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { idParams } from "@/server/validation/listQuery";

// Pauses a line: nothing is sent on it until it is resumed.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: idParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getWhatsAppConnections().pause(session, params.id, platformMeta(request, traceId)) }),
});
