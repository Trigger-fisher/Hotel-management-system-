import "server-only";
import { z } from "zod";
import { getProfileReview } from "@/server/compose/profileReview";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";

// Super Admin: mark two possible-duplicate profiles "not the same" (the pair stops showing). Audited (profile_kept_apart).
export const dynamic = "force-dynamic";

const keepApartBody =z.strictObject({ kind: z.enum(["guest", "company"]), leftId: z.string().uuid(), rightId: z.string().uuid() });

export const POST = route({
  permission: "session",
  body: keepApartBody,
  handler: async ({ session, body, request, traceId }) => ({ data: await getProfileReview().keepApart(session, body, platformMeta(request, traceId)) }),
});
