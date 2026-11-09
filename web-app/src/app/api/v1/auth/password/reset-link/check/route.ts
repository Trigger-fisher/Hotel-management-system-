import "server-only";
import { z } from "zod";
import { getAuthService } from "@/server/compose/auth";
import { publicRoute } from "@/server/http/route";

// Opening the emailed reset link: 200 {valid: true} while it is good; expired, used, unknown or malformed: the same 404 NOT_FOUND.
export const dynamic = "force-dynamic";

export const GET = publicRoute({
  query: z.strictObject({ token: z.string().max(200) }),
  limits: [{ name: "reset-link-check", max: 30, windowSeconds: 60, by: "ip" }],
  handler: async ({ query }) => ({ data: (await getAuthService().checkResetLink(query.token)).data }),
});