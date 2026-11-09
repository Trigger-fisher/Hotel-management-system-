import "server-only";
import { getWhatsAppConnections } from "@/server/compose/whatsappConnections";
import { route } from "@/server/http/route";

// Can this server keep the guests' files? Writes, reads and deletes one tiny test file in the WhatsApp folder of the bucket and answers one plain sentence (never a key, address or bucket name).
// Super Admin and Platform Admin only.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route({
  permission: "session",
  idempotency: "off",
  limits: [{ name: "wa-storage-check", max: 10, windowSeconds: 60, by: "user" }],
  handler: async ({ session }) => ({ data: await getWhatsAppConnections().storageCheck(session) }),
});
