import "server-only";
import { getWhatsAppConnections } from "@/server/compose/whatsappConnections";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { testBody } from "@/server/services/whatsapp/connectionSchemas";
import { idParams } from "@/server/validation/listQuery";

// Connect step 6: send a test message to the number the operator types. `accepted` means Meta took it; delivery arrives later.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: idParams,
  body: testBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getWhatsAppConnections().test(session, params.id, body.to, platformMeta(request, traceId)) }),
});
