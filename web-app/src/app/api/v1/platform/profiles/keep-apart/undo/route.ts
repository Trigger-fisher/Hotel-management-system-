import "server-only";
import { z } from "zod";
import { getProfileReview } from "@/server/compose/profileReview";
import { route } from "@/server/http/route";
import { platformMeta } from "@/server/services/platform/access";

// Super Admin: take a "not the same" back (the pair shows again if it still shares a value). Audited (profile_kept_apart_undone).
export const dynamic = "force-dynamic";

const body = z.strictObject({ kind: z.enum(["guest", "company"]), leftId: z.string().uuid(), rightId: z.string().uuid() });

export const POST = route({
  permission: "session",
  body,
  handler: async ({ session, body: b, request, traceId }) => ({ data: await getProfileReview().undoKeepApart(session, b, platformMeta(request, traceId)) }),
});
