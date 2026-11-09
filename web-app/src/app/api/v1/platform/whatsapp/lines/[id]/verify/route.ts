import "server-only";
import { getWhatsAppConnections } from "@/server/compose/whatsappConnections";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { idParams } from "@/server/validation/listQuery";

// Connect step 3: read the number from Meta and prove the token. Answers 200 with { ok, code, message, line } even when Meta refused (the message is plain English).
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: idParams,
  handler: async ({ session, params, request, traceId }) => ({ data: await getWhatsAppConnections().verify(session, params.id, platformMeta(request, traceId)) }),
});
