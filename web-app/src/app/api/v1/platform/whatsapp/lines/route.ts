import "server-only";
import { getWhatsAppConnections } from "@/server/compose/whatsappConnections";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";
import { createLineBody } from "@/server/services/whatsapp/connectionSchemas";

// WhatsApp lines (Super Admin and Platform Admin): the list with each line's health, and "Connect a line" steps 1 and 2. The token is sealed at once and never returned.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  handler: async ({ session }) => ({ data: await getWhatsAppConnections().list(session) }),
});

export const POST = route({
  permission: "session",
  body: createLineBody,
  handler: async ({ session, body, request, traceId }) => ({ status: 201, data: await getWhatsAppConnections().create(session, body, platformMeta(request, traceId)) }),
});
