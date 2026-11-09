import "server-only";
import { getHealthUsage } from "@/server/compose/healthUsage";
import { route } from "@/server/http/route";

// System Health usage (per-feature recorded actions, people, trend, journeys between features, record counts, pool and database size).
// Built from the system log, not from a request log (HMS has none): see services/systemAdmin/healthUsage.ts. SuperAdmin only.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  handler: async ({ session }) => ({ data: await getHealthUsage().usage(session) }),
});