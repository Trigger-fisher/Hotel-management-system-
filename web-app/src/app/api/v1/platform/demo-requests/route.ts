import "server-only";
import { getDemoRequests } from "@/server/compose/demoRequests";
import { route } from "@/server/http/route";
import { demoRequestQuery } from "@/server/services/platform/demoRequestSchemas";

// The website's demo requests (platform 0169), newest first, by status. Super Admin only.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  query: demoRequestQuery,
  handler: async ({ session, query }) => ({ data: await getDemoRequests().list(session, query as Parameters<ReturnType<typeof getDemoRequests>["list"]>[1]) }),
});
