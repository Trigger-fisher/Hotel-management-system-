import "server-only";
import { z } from "zod";
import { getSecurity } from "@/server/compose/security";
import { route } from "@/server/http/route";
import { resetActor } from "@/server/services/security/access";

// The Warning and Critical security events, newest first (Super Admin, browser only; security/docs/SECURITY-INTEGRATION-PLAN-2026-11-01.md section 7).
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  query: z.strictObject({ severity: z.enum(["warning", "critical"]).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }),
  handler: async ({ session, query }) => {
    resetActor(session);
    return { data: (await getSecurity().repo.listEvents({ severity: query.severity, limit: query.limit })).map((e) => ({ ...e, at: e.at.toISOString() })) };
  },
});
