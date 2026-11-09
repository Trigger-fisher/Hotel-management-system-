import "server-only";
import { publicRoute } from "@/server/http/route";

// Public liveness: "the process answers" and nothing else (A8). No uptime, time, versions or configuration state: a public
// endpoint must reveal nothing an attacker can use. The details are in /api/v1/health/ready.
export const dynamic = "force-dynamic";

export const GET = publicRoute({ handler: async () => ({ data: { status: "ok" } }) });
