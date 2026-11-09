import "server-only";
import { z } from "zod";
import { getProfileReview } from "@/server/compose/profileReview";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";

// Super Admin: merge 1 to 10 possible-duplicate profiles into the one kept, with a written reason. The hotels' records of the others point at the kept one; the others stay as
// history; no hotel's bills, stays or records change. Two profiles with their own sign-in: 409. Audited (profile_merged) in the same transaction.
export const dynamic = "force-dynamic";

const uuid = z.string().uuid();
const body = z.strictObject({
  kind: z.enum(["guest", "company"]),
  keepId: uuid,
  mergeIds: z.array(uuid).min(1).max(10),
  reason: z.string().max(400),
});

export const POST = route({
  permission: "session",
  body,
  idempotency: "optional",
  limits: [{ name: "profile-merge", max: 60, windowSeconds: 3600, by: "user", message: "Many merges in the last hour. Please wait a little and try again." }],
  handler: async ({ session, body: b, request, traceId }) => ({ data: await getProfileReview().merge(session, b, platformMeta(request, traceId)) }),
});
