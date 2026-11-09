import "server-only";
import { getAdminSettings } from "@/server/compose/admin";
import { route } from "@/server/http/route";

// "Check DNS" (Settings > Email > My own domain): looks the DNS records of the hotel's own sender domain up and keeps the answer (ok / missing / wrong for each record). SuperAdmin only;
// a few an hour (each one asks the public DNS).
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route({
  permission: "session",
  idempotency: "off",
  limits: [{ name: "settings-check-domain", max: 20, windowSeconds: 3600, by: "session" }],
  handler: async ({ session }) => ({ data: await getAdminSettings().checkDomain(session) }),
});