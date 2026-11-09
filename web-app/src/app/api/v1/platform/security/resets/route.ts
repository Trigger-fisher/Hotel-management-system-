import "server-only";
import { z } from "zod";
import { getSecurity } from "@/server/compose/security";
import { route } from "@/server/http/route";
import { resetActor } from "@/server/services/security/access";

// Emergency resets (security/docs/SECURITY-INTEGRATION-PLAN-2026-11-01.md section 9), Super Admin in the browser only. Layers 1 (edge) and 2 (application) run at once; layer 3 (database) waits for a
// DIFFERENT Super Admin to approve. For layer 1 the reason may carry `ip=203.0.113.7` to block that address.
export const dynamic = "force-dynamic";

export const GET = route({
  permission: "session",
  handler: async ({ session }) => ({ data: (await getSecurity().resets.list(resetActor(session))).map(({ createdAt, finishedAt, ...r }) => ({ ...r, createdAt: createdAt.toISOString(), finishedAt: finishedAt?.toISOString() ?? null })) }),
});

export const POST = route({
  permission: "session",
  body: z.strictObject({ layer: z.union([z.literal(1), z.literal(2), z.literal(3)]), reason: z.string().max(500) }),
  limits: [{ name: "security-reset", max: 5, windowSeconds: 60, by: "user" }],
  handler: async ({ session, body }) => {
    const { createdAt, finishedAt, ...r } = await getSecurity().resets.request(resetActor(session), body);
    return { data: { ...r, createdAt: createdAt.toISOString(), finishedAt: finishedAt?.toISOString() ?? null }, status: 201 };
  },
});
