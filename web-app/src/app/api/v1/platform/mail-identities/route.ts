import "server-only";
import { getPlatformIdentities } from "@/server/compose/platform";
import { route } from "@/server/http/route";

// Sender identities (Platform > Mail senders): the platform's sending domain and the domains hotels bring, each with its DNS records and the last check. Super Admin only.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  handler: async ({ session }) => ({ data: await getPlatformIdentities().list(session) }),
});