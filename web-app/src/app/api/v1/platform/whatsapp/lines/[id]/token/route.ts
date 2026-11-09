import "server-only";
import { getWhatsAppConnections } from "@/server/compose/whatsappConnections";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { replaceTokenBody } from "@/server/services/whatsapp/connectionSchemas";
import { idParams } from "@/server/validation/listQuery";

// Replace a line's token: sealed at once, never echoed. An active line needs its name typed in `confirm`.
export const dynamic = "force-dynamic";

export const PUT = route({
  permission: "session",
  params: idParams,
  body: replaceTokenBody,
  handler: async ({ session, params, body, request, traceId }) => ({ data: await getWhatsAppConnections().replaceToken(session, params.id, body, platformMeta(request, traceId)) }),
});
