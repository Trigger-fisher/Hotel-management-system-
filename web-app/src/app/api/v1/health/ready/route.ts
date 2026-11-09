import "server-only";
import { ConfigError, getConfig, isDatabaseConfigured } from "@/server/config/env";
import { databaseAnswers } from "@/server/compose/health";
import { publicRoute } from "@/server/http/route";
import { getLogger } from "@/server/logger";

// Readiness for a load balancer or an uptime check: the environment is valid and, when a database is configured, it answers `SELECT 1` within 2 seconds
// (503 otherwise). No secrets and no variable names, only the words ready / unhealthy.
export const dynamic = "force-dynamic";

export const GET = publicRoute<undefined, undefined, undefined, Record<string, unknown>>({
  limits: [{ name: "ready", max: 120, windowSeconds: 60, by: "ip" }],
  handler: async ({ traceId }) => {
    try {
      const config = getConfig();
      if (isDatabaseConfigured(config) && !(await databaseAnswers())) {
        getLogger().error("health: database not answering", { traceId });
        return { data: { status: "unhealthy", db: "down" }, status: 503 };
      }
      return { data: { status: "ready", uptimeSeconds: Math.round(process.uptime()), time: new Date().toISOString(), db: isDatabaseConfigured(config) ? "ok" : "not configured" } };
    } catch (error) {
      // A wrong environment is reported as not ready, with the problem names in the log only.
      if (error instanceof ConfigError) getLogger().error("health: invalid configuration", { traceId, problems: error.problems });
      return { data: { status: "unhealthy", config: "invalid" }, status: 503 };
    }
  },
});
