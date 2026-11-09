import "server-only";
import { getWhatsAppConnections } from "@/server/compose/whatsappConnections";
import { route } from "@/server/http/route";

// Whether the app's settings are present (never their values), the callback address to give Meta and the webhook fields to subscribe.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  handler: async ({ session }) => ({ data: await getWhatsAppConnections().appStatus(session) }),
});
