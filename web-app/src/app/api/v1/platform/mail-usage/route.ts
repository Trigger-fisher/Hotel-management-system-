import "server-only";
import { getPlatformMailUsage } from "@/server/compose/platform";
import { route } from "@/server/http/route";
import { mailUsageQuery } from "@/server/services/platform/schemas";

// Mail usage by month (Platform > Mail usage): mails sent per hotel and by the platform, today's count and the Super Admin's daily cap of each hotel. Super Admin only.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  query: mailUsageQuery,
  handler: async ({ session, query }) => ({ data: await getPlatformMailUsage().report(session, query.month) }),
});