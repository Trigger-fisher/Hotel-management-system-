import "server-only";
import { getCron } from "@/server/compose/cron";
import { publicRoute } from "@/server/http/route";

// Nightly copy of every provisioned hotel's data. The backup service has a 270-second work budget.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = publicRoute({
  limits: [{ name: "cron", max: 60, windowSeconds: 60, by: "ip" }],
  handler: async ({ request }) => {
    getCron().authorize(request);
    return { data: await getCron().backup() };
  },
});
