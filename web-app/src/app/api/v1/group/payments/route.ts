import "server-only";
import { getGroupPayments } from "@/server/compose/groupPayments";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// Online payments across the hotels of the signed-in Group Hotel Admin's own group: per hotel the money in, failures, refunds and problems waiting, and the newest payments. Read only.
export const GET = route({
  permission: "session",
  cache: "private, no-cache",
  handler: async ({ session }) => ({ data: await getGroupPayments().overview(session) }),
});