import "server-only";
import { getWhatsAppConnections } from "@/server/compose/whatsappConnections";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { disconnectBody } from "@/server/services/whatsapp/connectionSchemas";
import { idParams } from "@/server/validation/listQuery";

// Disconnects a line (its name typed in `confirm`). Refused with 409 while any hotel is attached.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: idParams,
  body: disconnectBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getWhatsAppConnections().disconnect(session, params.id, body, platformMeta(request, traceId)) }),
});
