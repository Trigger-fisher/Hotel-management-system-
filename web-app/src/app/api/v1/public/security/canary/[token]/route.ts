import "server-only";
import { z } from "zod";
import { canaryKey, getSecurity } from "@/server/compose/security";
import { AppError } from "@/server/errors";
import { clientAddress } from "@/server/http/clientAddress";
import { publicRoute } from "@/server/http/route";
import { edgeCountry } from "@/server/services/security/edge";
import { verifyCanary } from "@/server/services/security/honeypot";

// A canary address (security/docs/SECURITY-INTEGRATION-PLAN-2026-11-01.md section 8): planted in a decoy file by `npm run security:decoy`. Opening it raises a Critical alert; the caller sees a plain 404.
// An address we did not make records nothing, so guessing cannot raise false alarms.
export const dynamic = "force-dynamic";

export const GET = publicRoute({
  params: z.strictObject({ token: z.string().max(80) }),
  limits: [{ name: "canary", max: 30, windowSeconds: 60, by: "ip" }],
  handler: async ({ params, request, traceId }) => {
    const key = canaryKey();
    const label = key ? verifyCanary(key, params.token) : null;
    if (label !== null) {
      await getSecurity().events.record({ kind: "canary_triggered", summary: `Canary opened: the decoy "${label}" was read by someone`, ip: clientAddress(request), traceId, detail: { label, userAgent: request.headers.get("user-agent") ?? "", country: edgeCountry(request) } });
    }
    throw new AppError("NOT_FOUND");
  },
});
