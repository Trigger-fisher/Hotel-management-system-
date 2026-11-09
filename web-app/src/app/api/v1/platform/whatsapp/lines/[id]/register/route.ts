import "server-only";
import { getWhatsAppConnections } from "@/server/compose/whatsappConnections";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { idParams } from "@/server/validation/listQuery";

// Connect step 5: register the number. The two-step PIN is made on the server, sealed and never shown.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: idParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getWhatsAppConnections().register(session, params.id, platformMeta(request, traceId)) }),
});
