import "server-only";
import { getSecurity } from "@/server/compose/security";
import { route } from "@/server/http/route";
import { idParams } from "@/server/validation/listQuery";
import { resetActor } from "@/server/services/security/access";

// A layer 3 (database) reset waiting for a second Super Admin: the one who asked cannot approve it.
export const dynamic = "force-dynamic";

export const POST = route({
  permission: "session",
  params: idParams,
  limits: [{ name: "security-reset", max: 5, windowSeconds: 60, by: "user" }],
  handler: async ({ session, params }) => {
    const { createdAt, finishedAt, ...r } = await getSecurity().resets.approve(resetActor(session), params.id);
    return { data: { ...r, createdAt: createdAt.toISOString(), finishedAt: finishedAt?.toISOString() ?? null } };
  },
});
