import "server-only";
import { getDemoRequests } from "@/server/compose/demoRequests";
import { publicRoute } from "@/server/http/route";
import { demoRequestBody } from "@/server/services/platform/demoRequestSchemas";

// The product website's demo form (/contact; platform 0169). Same site only (a cross-site POST is refused by the wrapper), JSON of 16 KB at most, a few per address.
// A filled honeypot is answered as success and dropped.
export const dynamic = "force-dynamic";

export const POST = publicRoute({
  body: demoRequestBody,
  maxBodyBytes: 16 * 1024,
  idempotency: "off",
  limits: [{ name: "demo-request", max: 3, windowSeconds: 60, by: "ip" }, { name: "demo-request-day", max: 10, windowSeconds: 86_400, by: "ip" }],
  handler: async ({ body }) => ({ data: await getDemoRequests().submit(body), status: 201 }),
});
